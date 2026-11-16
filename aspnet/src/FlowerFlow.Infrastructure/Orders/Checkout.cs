using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Orders;

public sealed record OrderCreationLimit(int Maximum, DocumentReference Ref);

/// <summary>Port of backend/orders/checkout.js. Stock, rate quotas and idempotency are committed in one Firestore transaction.</summary>
public sealed class Checkout(Func<FirestoreDb> database, Reservations reservations, OrderTracking tracking, ILogger<Checkout> logger)
{
    private static Task Error(HttpContext context, int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
    private static string ProductId(Dictionary<string, object> item) => (string)(item.GetValueOrDefault("productId") ?? item["id"]);
    private static double Numeric(Dictionary<string, object> item, string key) => Convert.ToDouble(item[key], CultureInfo.InvariantCulture);
    public static string RequestHash(Dictionary<string, object> checkout, string note, string uid) => Convert.ToHexStringLower(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsJson.Stringify(new Dictionary<string, object>(checkout) { ["orderNote"] = note, ["uid"] = uid }))));
    public static async Task<bool> QuantityLimitErrorAsync(HttpContext context, JsonElement body)
    {
        var items = Js.Get(body, "items");
        if (items.ValueKind != JsonValueKind.Array || !items.EnumerateArray().Any(item => Js.Number(Js.Get(item, "quantity")) > OrderConfig.MaxQuantityPerProduct)) return false;
        await Error(context, 400, "quantity-limit", $"Mỗi lựa chọn bó hoa đặt tối đa {OrderConfig.MaxQuantityPerProduct} bó. Hãy giảm số lượng, hoặc liên hệ cửa hàng nếu cần số lượng lớn."); return true;
    }
    private static Dictionary<string, object> CartLine(Dictionary<string, object> item, DocumentSnapshot snapshot)
    {
        var data = snapshot.Exists ? snapshot.ToDictionary() : new Dictionary<string, object>();
        return new Dictionary<string, object>(item) { ["data"] = data, ["price"] = OrderPricing.GetProductPrice(Js.Element(data)),
            ["stock"] = Js.Number(Js.Element(data.GetValueOrDefault("quantity"))), ["ref"] = snapshot.Reference };
    }
    private static Dictionary<string, object> PublicItem(Dictionary<string, object> item)
    {
        var data = (Dictionary<string, object>)item["data"]; var saleType = OrderPricing.GetProductSaleType(Js.Element(data));
        var result = new Dictionary<string, object>
        {
            ["id"] = item["id"], ["productId"] = ProductId(item), ["title"] = Js.Cut(Js.String(Js.Element(FirestoreValues.Or(data, "title", "Sản phẩm"))), 120),
            ["image"] = Js.Cut(Js.String(Js.Element(FirestoreValues.Or(data, "image"))), 1000), ["saleType"] = saleType,
            ["unit"] = saleType == "flower" ? "cành" : "bó", ["quantity"] = item["quantity"], ["price"] = item["price"], ["stock"] = item["stock"]
        };
        if (saleType != "flower") result["priceUpdatedAt"] = "";
        else if (data.TryGetValue("priceUpdatedAt", out var updated)) result["priceUpdatedAt"] = updated;
        foreach (var name in new[] { "customBouquetId", "size", "color", "cardMessage", "personalNote" }) result[name] = FirestoreValues.Or(item, name);
        return result;
    }

    public async Task QuoteOrderAsync(HttpContext context)
    {
        var body = await JsonInput.ReadAsync(context); if (await QuantityLimitErrorAsync(context, body)) return;
        var quote = OrderValidation.ValidateQuote(body);
        if (quote is null) { await Error(context, 400, "invalid-checkout", "Danh sách sản phẩm không hợp lệ."); return; }
        try
        {
            var db = database(); await reservations.ReleaseExpiredReservationsAsync(db, context.RequestAborted);
            var items = (List<Dictionary<string, object>>)quote["items"];
            var productsTask = db.GetAllSnapshotsAsync(items.Select(item => db.Collection("products").Document(ProductId(item))), context.RequestAborted);
            var promotionsTask = db.Collection("metadata").Document("activePromotions").GetSnapshotAsync(context.RequestAborted);
            var deliveryTask = db.Collection("metadata").Document("deliveryZones").GetSnapshotAsync(context.RequestAborted);
            var wrappingTask = db.Collection("metadata").Document("bouquetWrapping").GetSnapshotAsync(context.RequestAborted);
            await Task.WhenAll(productsTask, promotionsTask, deliveryTask, wrappingTask);
            var products = await productsTask; var promotions = await promotionsTask; var delivery = await deliveryTask; var wrapping = await wrappingTask;
            var (zone, shipping) = OrderPricing.ResolveDeliveryZone(Js.Element(delivery.ToDictionary()), (string)quote["deliveryZoneId"]);
            var shortages = new List<Dictionary<string, object>>();
            var cart = items.Select((item, index) =>
            {
                var snapshot = products[index]; var line = CartLine(item, snapshot); var data = (Dictionary<string, object>)line["data"];
                var price = Numeric(line, "price"); var stock = Numeric(line, "stock");
                var shortage = new Dictionary<string, object> { ["id"] = item["id"], ["title"] = Js.Cut(Js.StringOrEmpty(Js.Element(data.GetValueOrDefault("title"))), 120), ["available"] = 0 };
                if (data.GetValueOrDefault("status") is "hidden") { shortage["hidden"] = true; shortages.Add(shortage); return line; }
                if (!snapshot.Exists || !double.IsFinite(price) || price <= 0 || !Js.Integer(stock) || stock < BouquetOptions.Demand(items, ProductId(item)))
                { shortage["available"] = snapshot.Exists && Js.Integer(stock) && double.IsFinite(price) && price > 0 ? Math.Max(0, stock) : 0; shortages.Add(shortage); }
                return line;
            }).ToList();
            var unavailable = shortages.Where(item => item.GetValueOrDefault("hidden") is true).ToList();
            if (unavailable.Count > 0)
            {
                var names = string.Join(", ", unavailable.Select(item => $"“{FirestoreValues.Or(item, "title", "Sản phẩm")}”"));
                await Error(context, 409, "product-unavailable", $"{names} hiện đang tạm ẩn và không thể đặt hàng. Hãy chọn sản phẩm khác."); return;
            }
            if (shortages.Count > 0)
            {
                var message = string.Join("; ", shortages.Select(item => Convert.ToDouble(item["available"], CultureInfo.InvariantCulture) > 0
                    ? $"“{FirestoreValues.Or(item, "title", "Một sản phẩm")}” chỉ còn {Js.String(Js.Element(item["available"]))} sản phẩm"
                    : $"“{FirestoreValues.Or(item, "title", "Một sản phẩm")}” đã hết hàng"));
                context.Response.StatusCode = 409; await context.Response.WriteAsJsonAsync(new { code = "insufficient-stock", error = message + ". Hãy giảm số lượng hoặc xóa sản phẩm đó khỏi giỏ.", items = shortages }, context.RequestAborted); return;
            }
            var promotion = OrderPricing.FindPromotion(Js.Get(Js.Element(promotions.ToDictionary()), "items"), (string)quote["promotionId"]);
            var totals = OrderPricing.PriceCart(cart, promotion); var bouquets = OrderPricing.CalculateCustomBouquets(cart, Js.Get(Js.Element(wrapping.ToDictionary()), "tiers"));
            var wrappingFee = bouquets.Sum(item => Numeric(item, "wrappingFee"));
            totals["wrappingFee"] = wrappingFee; totals["shippingFee"] = shipping; totals["total"] = Numeric(totals, "subtotal") - Numeric(totals, "savings") + wrappingFee + shipping;
            var publicZone = zone is null ? null : new Dictionary<string, object> { ["id"] = zone["id"], ["province"] = zone["province"], ["district"] = zone["district"], ["fee"] = zone["fee"] };
            await context.Response.WriteAsJsonAsync(new { totals, customBouquets = bouquets, deliveryZone = publicZone,
                deliveryZonesConfigured = OrderPricing.GetEnabledDeliveryZones(Js.Element(delivery.ToDictionary())).Count > 0,
                items = cart.Select(item => FirestoreValues.JsonCompatible(PublicItem(item))).ToList() }, context.RequestAborted);
        }
        catch (BackendException error) when (new[] { "invalid-promotion", "insufficient-stock", "product-unavailable", "delivery-zone-unavailable", "invalid-custom-bouquet", "bouquet-quantity-limit", "bouquet-wrapping-unavailable" }.Contains(error.Code))
        { await Error(context, 409, error.Code, error.Message); }
        catch { logger.LogError("Order quote failed."); await Error(context, 503, "order-service-unavailable", "Chưa thể kiểm tra giá đơn hàng. Vui lòng thử lại sau."); }
    }

    public static List<OrderCreationLimit> CreationLimitRefs(FirestoreDb db, HttpContext context, FirebaseIdentity? user, string phone)
    {
        var ip = context.Request.Headers["x-forwarded-for"].ToString().Split(',')[0].Trim(); var secret = FirebaseServiceAccount.ReadJson();
        if (ip.Length is < 1 or > 64) throw new InvalidOperationException("Trusted order source unavailable");
        var values = new List<(string Type, string Value, int Maximum)> { ("ip", ip, 5), ("phone", OrderValidation.NormalizePhone(phone), 3) };
        if (user is not null) values.Add(("account", user.Uid, 5));
        return values.Select(value => new OrderCreationLimit(value.Maximum, db.Collection("orderCreationLimits").Document(Convert.ToHexStringLower(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(value.Type + ":" + value.Value)))))).ToList();
    }

    public async Task CreateOrderAsync(HttpContext context)
    {
        var body = await JsonInput.ReadAsync(context); var note = Js.StringOrEmpty(Js.Get(body, "orderNote")).Trim();
        if (note.Length > OrderConfig.MaxOrderNoteLength)
        { await Error(context, 400, "note-too-long", $"Ghi chú tối đa {OrderConfig.MaxOrderNoteLength} ký tự. Hãy rút gọn ghi chú rồi đặt lại."); return; }
        if (await QuantityLimitErrorAsync(context, body)) return;
        var checkout = OrderValidation.ValidateCheckout(body);
        if (checkout is null) { await Error(context, 400, "invalid-checkout", "Thông tin đặt hàng hoặc danh sách sản phẩm không hợp lệ."); return; }
        try
        {
            var user = await tracking.OptionalAuthenticatedUserAsync(context); var uid = user?.Uid ?? "";
            var db = database(); await reservations.ReleaseExpiredReservationsAsync(db, context.RequestAborted);
            var limits = CreationLimitRefs(db, context, user, (string)checkout["phone"]);
            var key = (string)checkout["idempotencyKey"]; var idempotencyRef = db.Collection("orderRequests").Document(key);
            var items = (List<Dictionary<string, object>>)checkout["items"]; var productRefs = items.Select(item => db.Collection("products").Document(ProductId(item))).ToList();
            var nowMillis = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); var nowIso = DateTimeOffset.FromUnixTimeMilliseconds(nowMillis).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            var hash = RequestHash(checkout, note, uid);
            var order = await db.RunTransactionAsync(async transaction =>
            {
                var previous = await transaction.GetSnapshotAsync(idempotencyRef, context.RequestAborted);
                if (previous.Exists)
                {
                    var saved = previous.ToDictionary(); var oldHash = saved.GetValueOrDefault("requestHash");
                    if (saved.GetValueOrDefault("uid") as string != uid || FirestoreValues.Truthy(oldHash) && oldHash as string != hash)
                        throw new BackendException("idempotency-conflict", "Mã yêu cầu đã được dùng cho nội dung đặt hàng khác. Hãy kiểm tra đơn đã gửi.");
                    var oldRef = db.Collection("orders").Document(Js.StringOrEmpty(Js.Element(saved.GetValueOrDefault("orderId"))));
                    var old = await transaction.GetSnapshotAsync(oldRef, context.RequestAborted);
                    if (!old.Exists) throw new BackendException("idempotency-conflict", "Yêu cầu đặt hàng này đã được xử lý nhưng đơn không còn tồn tại.");
                    var data = old.ToDictionary(); var result = new Dictionary<string, object> { ["id"] = old.Id,
                        ["shippingFee"] = Js.NumberOrZero(Js.Element(data.GetValueOrDefault("shippingFee"))), ["wrappingFee"] = Js.NumberOrZero(Js.Element(data.GetValueOrDefault("wrappingFee"))) };
                    foreach (var field in new[] { "paymentReference", "subtotal", "savings", "total" }) if (data.TryGetValue(field, out var value)) result[field] = value;
                    return result;
                }
                var limitSnapshots = await transaction.GetAllSnapshotsAsync(limits.Select(limit => limit.Ref), context.RequestAborted);
                var limitUpdates = limits.Select((limit, index) =>
                {
                    var record = limitSnapshots[index].Exists ? limitSnapshots[index].ToDictionary() : new Dictionary<string, object>();
                    var until = record.GetValueOrDefault("expiresAt") is Timestamp timestamp ? FirestoreValues.ToMillis(timestamp) : 0;
                    var count = until > nowMillis ? Js.NumberOrZero(Js.Element(record.GetValueOrDefault("count"))) : 0;
                    if (count >= limit.Maximum) throw new BackendException("order-rate-limited", "Bạn đã gửi nhiều đơn trong thời gian ngắn. Vui lòng thử lại sau.", Math.Max(1, (int)Math.Ceiling((until - nowMillis) / 1000d)));
                    return (limit.Ref, Count: count + 1, Expires: FirestoreValues.FromMillis(until > nowMillis ? until : nowMillis + 15 * 60_000L));
                }).ToList();
                if (user is null && items.Any(item => BouquetOptions.Demand(items, ProductId(item)) > 5))
                    throw new BackendException("guest-quantity-limit", "Khách chưa đăng nhập đặt tối đa 5 sản phẩm mỗi loại trong một đơn. Hãy đăng nhập để đặt số lượng lớn hơn.");
                var schedule = OrderValidation.DeliveryScheduleError((string)checkout["deliveryDate"], (string)checkout["deliveryTime"]);
                if (schedule.Length > 0) throw new BackendException("invalid-delivery-schedule", schedule);
                var productsTask = transaction.GetAllSnapshotsAsync(productRefs, context.RequestAborted);
                var promosTask = transaction.GetSnapshotAsync(db.Collection("metadata").Document("activePromotions"), context.RequestAborted);
                var deliveryTask = transaction.GetSnapshotAsync(db.Collection("metadata").Document("deliveryZones"), context.RequestAborted);
                var wrappingTask = transaction.GetSnapshotAsync(db.Collection("metadata").Document("bouquetWrapping"), context.RequestAborted);
                await Task.WhenAll(productsTask, promosTask, deliveryTask, wrappingTask);
                var snapshots = await productsTask; var promotions = await promosTask; var delivery = await deliveryTask; var wrapping = await wrappingTask;
                var (zone, shipping) = OrderPricing.ResolveDeliveryZone(Js.Element(delivery.ToDictionary()), (string)checkout["deliveryZoneId"]);
                var products = items.Select((item, index) =>
                {
                    var snapshot = snapshots[index]; if (!snapshot.Exists) throw new BackendException("product-unavailable", "Một sản phẩm không còn bán.");
                    var line = CartLine(item, snapshot); var data = (Dictionary<string, object>)line["data"];
                    if (data.GetValueOrDefault("status") is "hidden") throw new BackendException("product-unavailable", $"“{Js.Cut(Js.String(Js.Element(FirestoreValues.Or(data, "title", "Sản phẩm"))), 120)}” hiện đang tạm ẩn và không thể đặt hàng.");
                    var price = Numeric(line, "price"); var stock = Numeric(line, "stock"); var title = Js.String(Js.Element(FirestoreValues.Or(data, "title", "Một sản phẩm")));
                    if (!double.IsFinite(price) || price <= 0) throw new BackendException("product-unavailable", $"“{title}” hiện chưa có giá bán. Hãy bỏ sản phẩm này khỏi giỏ.");
                    if (!Js.Integer(stock) || stock < BouquetOptions.Demand(items, ProductId(item)))
                    {
                        var available = Js.Integer(stock) ? Math.Max(0, stock) : 0;
                        throw new BackendException("insufficient-stock", available > 0 ? $"“{title}” vừa có người mua, chỉ còn {Js.String(Js.Element(available))} sản phẩm. Hãy giảm số lượng rồi đặt lại."
                            : $"“{title}” vừa hết hàng. Hãy bỏ sản phẩm này khỏi giỏ.");
                    }
                    return line;
                }).ToList();
                var promotion = OrderPricing.FindPromotion(Js.Get(Js.Element(promotions.ToDictionary()), "items"), (string)checkout["promotionId"]);
                var totals = OrderPricing.PriceCart(products, promotion); var bouquets = OrderPricing.CalculateCustomBouquets(products, Js.Get(Js.Element(wrapping.ToDictionary()), "tiers"));
                var subtotal = Numeric(totals, "subtotal"); var savings = Numeric(totals, "savings"); var fee = bouquets.Sum(item => Numeric(item, "wrappingFee")); var total = subtotal - savings + fee + shipping;
                var expected = (JsonElement)checkout["expectedTotals"];
                if (Js.Number(Js.Get(expected, "subtotal")) != subtotal || Js.Number(Js.Get(expected, "savings")) != savings || Js.Number(Js.Get(expected, "tax")) != 0
                    || Js.Number(Js.Get(expected, "shippingFee")) != shipping || (Js.Get(expected, "wrappingFee").ValueKind == JsonValueKind.Undefined ? 0 : Js.Number(Js.Get(expected, "wrappingFee"))) != fee
                    || Js.Number(Js.Get(expected, "total")) != total)
                    throw new BackendException("price-changed", "Giá hoặc ưu đãi vừa thay đổi. Hãy quay lại trang thanh toán để xem tổng tiền mới.");
                var orderRef = db.Collection("orders").Document(); var method = (string)checkout["paymentMethod"];
                const string initialStatus = "Chờ xác nhận"; const string location = "Đơn hàng đã được gửi đến cửa hàng";
                var dataOrder = new Dictionary<string, object> { ["orderType"] = products.Any(item => OrderPricing.GetProductSaleType(Js.Element(item["data"])) == "flower") ? "custom_bouquet" : "ready_made", ["uid"] = uid };
                foreach (var field in new[] { "customerName", "phone", "address", "recipientName", "recipientPhone", "customerIsRecipient", "deliveryDate", "deliveryTime" }) dataOrder[field] = checkout[field];
                dataOrder["deliveryZoneId"] = zone!["id"]; dataOrder["deliveryProvince"] = zone["province"]; dataOrder["deliveryDistrict"] = zone["district"];
                foreach (var field in new[] { "greetingCard", "anonymousGreetingCard", "giftWrap" }) dataOrder[field] = checkout[field];
                dataOrder["createdAt"] = FieldValue.ServerTimestamp; dataOrder["status"] = initialStatus; dataOrder["currentLocation"] = location; dataOrder["estimatedDelivery"] = "";
                dataOrder["trackingHistory"] = new[] { new { status = initialStatus, location, estimatedDelivery = "", updatedAt = nowIso } }.Select(item => new Dictionary<string, object>
                    { ["status"] = item.status, ["location"] = item.location, ["estimatedDelivery"] = item.estimatedDelivery, ["updatedAt"] = item.updatedAt }).ToList();
                dataOrder["subtotal"] = subtotal; dataOrder["savings"] = savings; dataOrder["tax"] = 0; dataOrder["wrappingFee"] = fee; dataOrder["customBouquets"] = bouquets;
                dataOrder["shippingFee"] = shipping; dataOrder["total"] = total; dataOrder["paymentMethod"] = method;
                dataOrder["paymentStatus"] = method == "qr" ? "Chờ xác minh thanh toán" : method == "vnpay" ? "chua_thanh_toan" : "Thanh toán khi nhận hàng";
                dataOrder["paymentReference"] = OrderPricing.PaymentReferenceFor(key); dataOrder["paidAt"] = ""; dataOrder["paymentVerified"] = false;
                dataOrder["promotionId"] = promotion is null ? "" : checkout["promotionId"]; dataOrder["orderNote"] = note; dataOrder["items"] = products.Select(PublicItem).ToList();
                dataOrder["inventoryReserved"] = true; dataOrder["inventoryState"] = "reserved";
                dataOrder["reservationExpiresAt"] = FirestoreValues.FromMillis(nowMillis + (method == "qr" ? OrderConfig.QrReservationMs : method == "vnpay" ? OrderConfig.VnpayReservationMs : OrderConfig.CodReservationMs));
                foreach (var limit in limitUpdates) transaction.SetJs(limit.Ref, new Dictionary<string, object> { ["count"] = limit.Count, ["expiresAt"] = limit.Expires });
                var reserved = new HashSet<string>(StringComparer.Ordinal);
                foreach (var item in products) if (reserved.Add(ProductId(item))) transaction.UpdateJs((DocumentReference)item["ref"], new Dictionary<string, object> { ["quantity"] = Numeric(item, "stock") - BouquetOptions.Demand(items, ProductId(item)) });
                transaction.CreateJs(orderRef, dataOrder); transaction.CreateJs(idempotencyRef, new Dictionary<string, object> { ["orderId"] = orderRef.Id, ["requestHash"] = hash, ["uid"] = uid, ["createdAt"] = FieldValue.ServerTimestamp });
                return new Dictionary<string, object>(dataOrder) { ["id"] = orderRef.Id, ["createdAt"] = nowIso };
            }, cancellationToken: context.RequestAborted);
            var responseOrder = new Dictionary<string, object> { ["id"] = order["id"] }; if (order.TryGetValue("paymentReference", out var paymentReference)) responseOrder["paymentReference"] = paymentReference;
            var responseTotals = new Dictionary<string, object>(); foreach (var name in new[] { "subtotal", "savings", "wrappingFee", "shippingFee", "total" }) if (order.TryGetValue(name, out var value)) responseTotals[name] = value;
            context.Response.StatusCode = 201; await context.Response.WriteAsJsonAsync(new { order = responseOrder, totals = responseTotals }, context.RequestAborted);
        }
        catch (RequestIdentityException error) when (error.Code.StartsWith("auth/", StringComparison.Ordinal))
        { await Error(context, 401, "unauthenticated", "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại rồi đặt hàng."); }
        catch (BackendException error) when (error.Code == "order-rate-limited")
        { context.Response.Headers.RetryAfter = error.RetryAfter?.ToString(CultureInfo.InvariantCulture); await Error(context, 429, error.Code, error.Message); }
        catch (BackendException error) when (error.Code == "guest-quantity-limit") { await Error(context, 400, error.Code, error.Message); }
        catch (BackendException error) when (new[] { "invalid-checkout", "invalid-delivery-schedule", "invalid-promotion", "insufficient-stock", "product-unavailable", "price-changed", "idempotency-conflict", "delivery-zone-unavailable", "invalid-custom-bouquet", "bouquet-quantity-limit", "bouquet-wrapping-unavailable" }.Contains(error.Code))
        { await Error(context, error.Code is "invalid-checkout" or "invalid-delivery-schedule" ? 400 : 409, error.Code, error.Message); }
        catch { logger.LogError("Order creation failed."); await Error(context, 503, "order-service-unavailable", "Chưa thể xác nhận đơn hàng. Vui lòng thử lại sau."); }
    }
}
