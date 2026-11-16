using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FlowerFlow.Application.Payments;
using FlowerFlow.Infrastructure.Orders;
using FlowerFlow.Infrastructure.Payments;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

static class IpnContracts
{
    public static async Task RunAsync(FirestoreDb db)
    {
        var cfg = new Dictionary<string, string?> { ["VNPAY_TMN_CODE"] = "TEST", ["VNPAY_HASH_SECRET"] = "test-secret" };
        var service = new VnpayIpnHandler(() => db, new Reservations(NullLogger<Reservations>.Instance), NullLogger<VnpayIpnHandler>.Instance, name => cfg.GetValueOrDefault(name));
        var currentId = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)); var oldId = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var order = db.Collection("orders").Document(); var expiry = Timestamp.FromDateTime(DateTime.UtcNow.AddMinutes(15));
        await order.SetAsync(new { paymentMethod = "vnpay", total = 100000, status = "Chờ xác nhận", inventoryReserved = true,
            reservationExpiresAt = expiry, vnpTxnRef = currentId, paymentStatus = "chua_thanh_toan" });
        foreach (var id in new[] { currentId, oldId }) await db.Collection("paymentTransactions").Document(id).SetAsync(new { orderId = order.Id, amount = 100000, status = "pending" });
        var invalid = Callback(currentId); invalid.Request.QueryString = new QueryString(invalid.Request.QueryString + "bad");
        await service.HandleAsync(invalid); RequireCode(invalid, "97");
        var wrongAmount = Callback(currentId, amount: "20000000"); await service.HandleAsync(wrongAmount); RequireCode(wrongAmount, "04");
        AdditionalContracts.Require((await db.Collection("paymentTransactions").Document(currentId).GetSnapshotAsync()).GetValue<string>("status") == "pending", "Invalid callback changed payment state");
        var oldFailure = Callback(oldId, paid: false); await service.HandleAsync(oldFailure); RequireCode(oldFailure, "00");
        AdditionalContracts.Require((await order.GetSnapshotAsync()).GetValue<string>("paymentStatus") == "chua_thanh_toan", "Old failed attempt overwrote current payment");
        var success = Callback(currentId); await service.HandleAsync(success); RequireCode(success, "00");
        var paidOrder = await order.GetSnapshotAsync(); var paidAttempt = await db.Collection("paymentTransactions").Document(currentId).GetSnapshotAsync();
        AdditionalContracts.Require(paidOrder.GetValue<bool>("paymentVerified") && paidOrder.GetValue<string>("paymentStatus") == "da_thanh_toan", "Signed success did not confirm order");
        var duplicate = Callback(currentId); await service.HandleAsync(duplicate); RequireCode(duplicate, "00");
        AdditionalContracts.Require((await db.Collection("paymentTransactions").Document(currentId).GetSnapshotAsync()).GetValue<Timestamp>("processedAt") == paidAttempt.GetValue<Timestamp>("processedAt"), "Duplicate callback reprocessed attempt");
        var extraPayment = Callback(oldId); await service.HandleAsync(extraPayment); RequireCode(extraPayment, "00");
        AdditionalContracts.Require((await order.GetSnapshotAsync()).GetValue<bool>("latePayment"), "Second successful payment not flagged for attention");
        var lateId = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)); var lateOrder = db.Collection("orders").Document();
        await lateOrder.SetAsync(new { paymentMethod = "vnpay", total = 100000, status = "Đã hủy", inventoryReserved = false, inventoryState = "released", vnpTxnRef = lateId });
        await db.Collection("paymentTransactions").Document(lateId).SetAsync(new { orderId = lateOrder.Id, amount = 100000, status = "expired" });
        var late = Callback(lateId); await service.HandleAsync(late); RequireCode(late, "00");
        var lateState = await lateOrder.GetSnapshotAsync();
        AdditionalContracts.Require(lateState.GetValue<bool>("latePayment") && !lateState.GetValue<bool>("inventoryReserved")
            && lateState.GetValue<string>("status") == "Đã hủy", "Late payment restored cancelled order/stock");
        var noConfiguration = new VnpayIpnHandler(() => db, new Reservations(NullLogger<Reservations>.Instance), NullLogger<VnpayIpnHandler>.Instance, _ => null);
        var missingConfig = Callback(currentId); await noConfiguration.HandleAsync(missingConfig); RequireCode(missingConfig, "99");
        var disconnectedId = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)); var disconnectedOrder = db.Collection("orders").Document();
        await disconnectedOrder.SetAsync(new { paymentMethod = "vnpay", total = 100000, status = "Chờ xác nhận", inventoryReserved = true, reservationExpiresAt = expiry });
        await db.Collection("paymentTransactions").Document(disconnectedId).SetAsync(new { orderId = disconnectedOrder.Id, amount = 100000, status = "pending" });
        var disconnected = Callback(disconnectedId); disconnected.RequestAborted = new CancellationToken(true); await service.HandleAsync(disconnected);
        AdditionalContracts.Require((await disconnectedOrder.GetSnapshotAsync()).GetValue<bool>("paymentVerified"), "Gateway disconnect skipped verified payment processing");
        Console.WriteLine("PASS: VNPay IPN signature/amount, exact RspCode capitalization, stale failures, duplicate success, extra payments and late-payment non-restoration.");
    }
    private static DefaultHttpContext Callback(string txnRef, bool paid = true, string amount = "10000000")
    {
        var parameters = new JsonObject { ["vnp_TmnCode"] = "TEST", ["vnp_TxnRef"] = txnRef, ["vnp_Amount"] = amount,
            ["vnp_CurrCode"] = "VND", ["vnp_ResponseCode"] = paid ? "00" : "24", ["vnp_TransactionStatus"] = paid ? "00" : "02", ["vnp_TransactionNo"] = "GATEWAY123" };
        var query = Vnpay.CanonicalQuery(parameters);
        var hash = Convert.ToHexStringLower(HMACSHA512.HashData(Encoding.UTF8.GetBytes("test-secret"), Encoding.UTF8.GetBytes(query)));
        var context = new DefaultHttpContext(); context.Request.Method = "GET"; context.Request.QueryString = new QueryString("?" + query + "&vnp_SecureHash=" + hash);
        context.Response.Body = new MemoryStream(); return context;
    }
    private static void RequireCode(HttpContext context, string code)
    { var body = CheckoutContracts.Body(context); AdditionalContracts.Require(context.Response.StatusCode == 200
        && body.GetProperty("RspCode").GetString() == code && body.TryGetProperty("Message", out _), "VNPay IPN response contract changed: " + body); }
}
