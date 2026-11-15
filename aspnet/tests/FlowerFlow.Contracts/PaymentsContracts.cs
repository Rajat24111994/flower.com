using System.Text.Json;
using System.Text.Json.Nodes;
using FlowerFlow.Application.Payments;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Orders;
using FlowerFlow.Infrastructure.Payments;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging.Abstractions;

static class PaymentsContracts
{
    public static async Task RunAsync(FirestoreDb db)
    {
        var cfg = new Dictionary<string, string?> { ["VNPAY_TMN_CODE"] = "TEST", ["VNPAY_HASH_SECRET"] = "test-secret", ["PUBLIC_APP_URL"] = "https://example.invalid" };
        var reservations = new Reservations(NullLogger<Reservations>.Instance);
        var service = new PaymentsHandler(() => db, reservations, NullLogger<PaymentsHandler>.Instance, name => cfg.GetValueOrDefault(name));
        var suffix = Guid.NewGuid().ToString("N"); var stock = db.Collection("products").Document("vnpay-stock-" + suffix);
        await stock.SetAsync(new { quantity = 8 }); var order = db.Collection("orders").Document();
        var expiry = Timestamp.FromDateTime(DateTime.UtcNow.AddMinutes(15));
        await order.SetAsync(new { paymentMethod = "vnpay", total = 100000, status = "Chờ xác nhận", inventoryReserved = true,
            inventoryState = "reserved", reservationExpiresAt = expiry, paymentReference = "FFPAY", items = new[] { new { id = stock.Id, quantity = 2 } } });
        var create = CheckoutContracts.Context(new { action = "create", orderId = order.Id, paymentReference = "FFPAY" }, "203.0.113.1", false);
        await service.HandleAsync(create); var body = CheckoutContracts.Body(create);
        AdditionalContracts.Require(create.Response.StatusCode == 200, "Payment creation failed: " + body);
        var url = body.GetProperty("paymentUrl").GetString()!; var parameters = Parameters(url); var txnRef = parameters["vnp_TxnRef"]!.GetValue<string>();
        AdditionalContracts.Require(Vnpay.VerifySignature(parameters, "test-secret") && !url.Contains("test-secret") && txnRef.Length == 32, "Invalid signed payment URL or secret exposed");
        var reuse = CheckoutContracts.Context(new { action = "create", orderId = order.Id, paymentReference = "FFPAY" }, "203.0.113.1", false);
        await service.HandleAsync(reuse);
        AdditionalContracts.Require(reuse.Response.StatusCode == 200 && CheckoutContracts.Body(reuse).GetProperty("paymentUrl").GetString() == url
            && (await db.Collection("paymentTransactions").WhereEqualTo("orderId", order.Id).GetSnapshotAsync()).Count == 1
            && (await stock.GetSnapshotAsync()).GetValue<double>("quantity") == 8, "Pending payment attempt not reused");
        var wrongReference = CheckoutContracts.Context(new { action = "create", orderId = order.Id, paymentReference = "WRONG" }, "203.0.113.1", false);
        await service.HandleAsync(wrongReference); AdditionalContracts.Require(wrongReference.Response.StatusCode == 404, "Wrong payment capability accepted");
        var status = CheckoutContracts.Context(new { }, "test", false); status.Request.Method = "GET"; status.Request.QueryString = new QueryString("?action=status&txnRef=" + txnRef);
        await service.HandleAsync(status); AdditionalContracts.Require(CheckoutContracts.Body(status).GetProperty("status").GetString() == "pending", "Pending payment status changed");
        var past = Timestamp.FromDateTime(DateTime.UtcNow.AddMinutes(-1));
        await order.UpdateAsync(new Dictionary<string, object> { ["reservationExpiresAt"] = past });
        await db.Collection("paymentTransactions").Document(txnRef).UpdateAsync(new Dictionary<string, object> { ["expiresAt"] = past });
        var retry = CheckoutContracts.Context(new { action = "retry", txnRef }, "203.0.113.1", false); await service.HandleAsync(retry);
        var retryBody = CheckoutContracts.Body(retry);
        AdditionalContracts.Require(retry.Response.StatusCode == 200, "Expired payment retry failed: " + retryBody);
        var newTxnRef = Parameters(retryBody.GetProperty("paymentUrl").GetString()!)["vnp_TxnRef"]!.GetValue<string>();
        var restoredOrder = await order.GetSnapshotAsync();
        AdditionalContracts.Require(newTxnRef != txnRef && restoredOrder.GetValue<bool>("inventoryReserved") && restoredOrder.GetValue<string>("status") == "Chờ xác nhận"
            && !restoredOrder.ContainsField("reservationExpiredAt") && (await stock.GetSnapshotAsync()).GetValue<double>("quantity") == 8
            && (await db.Collection("paymentTransactions").Document(txnRef).GetSnapshotAsync()).GetValue<string>("status") == "expired", "Retry did not restore stock/order exactly once");
        await order.UpdateAsync(new Dictionary<string, object> { ["paymentVerified"] = true });
        await db.Collection("paymentTransactions").Document(newTxnRef).UpdateAsync(new Dictionary<string, object> { ["status"] = "success" });
        var paidRetry = CheckoutContracts.Context(new { action = "retry", txnRef = newTxnRef }, "203.0.113.1", false);
        await service.HandleAsync(paidRetry); AdditionalContracts.Require(paidRetry.Response.StatusCode == 409
            && CheckoutContracts.Body(paidRetry).GetProperty("code").GetString() == "payment-already-complete", "Paid order created another attempt");
        Console.WriteLine("PASS: VNPay signed URL, capability checks, pending attempt reuse, expired retry stock restoration and paid-order rejection.");
    }
    public static JsonObject Parameters(string url)
    {
        var result = new JsonObject();
        foreach (var pair in QueryHelpers.ParseQuery(new Uri(url).Query)) result[pair.Key] = pair.Value.ToString();
        return result;
    }
}
