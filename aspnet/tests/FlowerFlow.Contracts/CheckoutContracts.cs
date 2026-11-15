using System.Text.Json;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Orders;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

static class CheckoutContracts
{
    public static async Task RunAsync(FirestoreDb db)
    {
        var suffix = Guid.NewGuid().ToString("N"); var oldSecret = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");
        try
        {
            Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", "checkout-test-" + suffix);
            using var identityCase = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\"}}");
            var tracking = new OrderTracking(() => db, new RequestIdentity(new FakeBackend(identityCase.RootElement)), NullLogger<OrderTracking>.Instance);
            var service = new Checkout(() => db, new Reservations(NullLogger<Reservations>.Instance), tracking, NullLogger<Checkout>.Instance);
            var productRef = db.Collection("products").Document("checkout-" + suffix);
            await productRef.SetAsync(new { title = "Bó hoa", price = 100000, quantity = 10, saleType = "ready_made", status = "active", image = "rose.jpg" });
            await db.Collection("metadata").Document("activePromotions").SetAsync(new { items = Array.Empty<object>() });
            await db.Collection("metadata").Document("deliveryZones").SetAsync(new { zones = new[] { new { id = "checkout-zone", province = "Hà Nội", district = "Ba Đình", fee = 25000, enabled = true } } });
            await db.Collection("metadata").Document("bouquetWrapping").SetAsync(new { tiers = new[] { new { maxStems = 50, fee = 15000 } } });
            var items = new[] { new { id = "line-standard", productId = productRef.Id, size = "standard", quantity = 2 },
                new { id = "line-large", productId = productRef.Id, size = "large", quantity = 3 } };
            var quote = Context(new { deliveryZoneId = "checkout-zone", items }, "checkout-" + suffix);
            await service.QuoteOrderAsync(quote); var quoteBody = Body(quote);
            AdditionalContracts.Require(quote.Response.StatusCode == 200 && quoteBody.GetProperty("totals").GetProperty("total").GetDouble() == 525000,
                "Quote base price, option demand or shipping changed: " + quoteBody);
            var checkout = new Dictionary<string, object> { ["customerName"] = "Khách 🌹", ["phone"] = "0901234567", ["address"] = "Đường Hoa",
                ["deliveryDate"] = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)).Date.AddDays(1).ToString("yyyy-MM-dd"), ["deliveryTime"] = "08:00–11:00",
                ["deliveryZoneId"] = "checkout-zone", ["paymentMethod"] = "qr", ["idempotencyKey"] = Guid.NewGuid().ToString(),
                ["expectedTotals"] = quoteBody.GetProperty("totals").Clone(), ["items"] = items, ["orderNote"] = "Giao cổng – 🌹\nHoa" };
            var first = Context(checkout, "checkout-" + suffix); var replay = Context(checkout, "checkout-" + suffix);
            await Task.WhenAll(service.CreateOrderAsync(first), service.CreateOrderAsync(replay));
            var firstBody = Body(first); var replayBody = Body(replay);
            AdditionalContracts.Require(first.Response.StatusCode == 201 && replay.Response.StatusCode == 201
                && firstBody.GetProperty("order").GetProperty("id").GetString() == replayBody.GetProperty("order").GetProperty("id").GetString()
                && (await productRef.GetSnapshotAsync()).GetValue<double>("quantity") == 5, "Concurrent idempotency reserved stock twice: " + firstBody + " / " + replayBody);
            var orderId = firstBody.GetProperty("order").GetProperty("id").GetString()!; var order = await db.Collection("orders").Document(orderId).GetSnapshotAsync();
            var data = order.ToDictionary();
            var history = (IEnumerable<object>)data["trackingHistory"]; var created = DateTimeOffset.Parse((string)((Dictionary<string, object>)history.First())["updatedAt"]);
            AdditionalContracts.Require(order.GetValue<string>("orderNote") == "Giao cổng – 🌹\nHoa" && order.GetValue<string>("uid") == "user-a"
                && FirestoreValues.ToMillis(order.GetValue<Timestamp>("reservationExpiresAt")) - created.ToUnixTimeMilliseconds() == OrderConfig.QrReservationMs,
                "Stored order identity/note/reservation changed");
            var conflicting = new Dictionary<string, object>(checkout) { ["orderNote"] = "Changed content" };
            var conflictContext = Context(conflicting, "checkout-" + suffix); await service.CreateOrderAsync(conflictContext);
            AdditionalContracts.Require(conflictContext.Response.StatusCode == 409 && Body(conflictContext).GetProperty("code").GetString() == "idempotency-conflict", "Idempotency key reused for new content");
            var stale = new Dictionary<string, object>(checkout) { ["idempotencyKey"] = Guid.NewGuid().ToString(),
                ["expectedTotals"] = new { subtotal = 500000, savings = 0, tax = 0, shippingFee = 25000, wrappingFee = 0, total = 525001 } };
            var staleContext = Context(stale, "checkout-" + suffix); await service.CreateOrderAsync(staleContext);
            AdditionalContracts.Require(staleContext.Response.StatusCode == 409 && Body(staleContext).GetProperty("code").GetString() == "price-changed"
                && (await productRef.GetSnapshotAsync()).GetValue<double>("quantity") == 5, "Stale total accepted or reserved stock");
            var small = new Dictionary<string, object>(checkout) { ["items"] = new[] { new { id = productRef.Id, quantity = 1 } },
                ["expectedTotals"] = new { subtotal = 100000, savings = 0, tax = 0, shippingFee = 25000, wrappingFee = 0, total = 125000 } };
            for (var index = 0; index < 2; index++)
            {
                small["idempotencyKey"] = Guid.NewGuid().ToString(); var request = Context(small, "checkout-" + suffix); await service.CreateOrderAsync(request);
                AdditionalContracts.Require(request.Response.StatusCode == 201, "Valid small order rejected before quota: " + Body(request));
            }
            small["idempotencyKey"] = Guid.NewGuid().ToString(); var quota = Context(small, "checkout-" + suffix); await service.CreateOrderAsync(quota);
            AdditionalContracts.Require(quota.Response.StatusCode == 429 && quota.Response.Headers.RetryAfter.Count > 0, "Phone order quota not enforced");
            var guest = new Dictionary<string, object>(small) { ["idempotencyKey"] = Guid.NewGuid().ToString(), ["phone"] = "0901111222", ["items"] = new[] { new { id = productRef.Id, quantity = 6 } } };
            var guestContext = Context(guest, "guest-" + suffix, false); await service.CreateOrderAsync(guestContext);
            AdditionalContracts.Require(guestContext.Response.StatusCode == 400 && Body(guestContext).GetProperty("code").GetString() == "guest-quantity-limit", "Guest quantity limit changed");
            await productRef.UpdateAsync(new Dictionary<string, object> { ["quantity"] = 1 });
            var raceBody = new Dictionary<string, object>(small) { ["phone"] = "0903333444", ["idempotencyKey"] = Guid.NewGuid().ToString() };
            var contenderA = Context(raceBody, "race-" + suffix); raceBody["idempotencyKey"] = Guid.NewGuid().ToString(); var contenderB = Context(raceBody, "race-" + suffix);
            await Task.WhenAll(service.CreateOrderAsync(contenderA), service.CreateOrderAsync(contenderB));
            AdditionalContracts.Require(new[] { contenderA.Response.StatusCode, contenderB.Response.StatusCode }.Order().SequenceEqual(new[] { 201, 409 })
                && (await productRef.GetSnapshotAsync()).GetValue<double>("quantity") == 0, "Concurrent orders oversold stock");
            Console.WriteLine("PASS: checkout quote/duplicate product options, concurrent idempotency, exact request content, price change, quotas, guest cap and no overselling.");
        }
        finally { Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", oldSecret); }
    }
    public static DefaultHttpContext Context(object payload, string ip, bool authenticated = true)
    {
        var context = new DefaultHttpContext(); context.Request.Method = "POST";
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload); context.Request.Body = new MemoryStream(bytes); context.Request.ContentLength = bytes.Length;
        context.Request.Headers["x-forwarded-for"] = ip; if (authenticated) context.Request.Headers.Authorization = "Bearer token";
        context.Response.Body = new MemoryStream(); return context;
    }
    public static JsonElement Body(HttpContext context)
    { using var document = JsonDocument.Parse(((MemoryStream)context.Response.Body).ToArray()); return document.RootElement.Clone(); }
}
