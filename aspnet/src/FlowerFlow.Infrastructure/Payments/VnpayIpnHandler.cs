using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Payments;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Orders;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Payments;

/// <summary>Port of backend/payments/vnpay-ipn.js. Only a signed gateway callback can confirm a VNPay payment.</summary>
public sealed class VnpayIpnHandler(Func<FirestoreDb> database, Reservations reservations, ILogger<VnpayIpnHandler> logger,
    Func<string, string?>? environment = null)
{
    private sealed record Reply(string Code, string Message);
    public static Task IpnReplyAsync(HttpContext context, string code, string message)
    {
        context.Response.StatusCode = 200;
        // Dictionary keys retain the gateway's required capitalization under ASP.NET's camel-case defaults.
        return context.Response.WriteAsJsonAsync(new Dictionary<string, string> { ["RspCode"] = code, ["Message"] = message }, context.RequestAborted);
    }
    private static string Text(JsonObject parameters, string key) => Js.StringOrEmpty(Js.Element(parameters[key]));
    private static bool Is(JsonObject parameters, string key, string text) => parameters[key] is JsonValue value && value.TryGetValue<string>(out var actual) && actual == text;
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method != "GET")
        { context.Response.Headers.Allow = "GET"; await FirebaseAdminService.SendErrorAsync(context, 405, "method-not-allowed", "VNPay IPN chỉ chấp nhận GET."); return; }
        VnpaySecrets secrets;
        try { secrets = Vnpay.GetSecrets(environment); }
        catch { await IpnReplyAsync(context, "99", "Configuration error"); return; }
        var parameters = new JsonObject();
        foreach (var pair in context.Request.Query) parameters[pair.Key] = pair.Value.Count == 1 ? JsonValue.Create(pair.Value[0])
            : new JsonArray(pair.Value.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
        if (!Vnpay.VerifySignature(parameters, secrets.HashSecret) || Text(parameters, "vnp_TmnCode") != secrets.TmnCode)
        { await IpnReplyAsync(context, "97", "Invalid signature"); return; }
        var txnRef = Text(parameters, "vnp_TxnRef");
        if (!Regex.IsMatch(txnRef, @"\A[a-f0-9]{32}\z")) { await IpnReplyAsync(context, "01", "Order not found"); return; }
        try
        {
            // Finish a verified gateway event even if the gateway closes its HTTP connection.
            var processingCancellation = CancellationToken.None;
            var db = database(); await reservations.ExpireReservationsAsync(db, cancellationToken: processingCancellation);
            var attemptRef = db.Collection("paymentTransactions").Document(txnRef);
            var result = await db.RunTransactionAsync(async transaction =>
            {
                var attemptSnapshot = await transaction.GetSnapshotAsync(attemptRef, processingCancellation);
                if (!attemptSnapshot.Exists) return new Reply("01", "Order not found");
                var attempt = attemptSnapshot.ToDictionary(); var rawAmount = Js.Element(attempt.GetValueOrDefault("amount"));
                if (attempt.GetValueOrDefault("orderId") is not string orderId || orderId.Length == 0
                    || !Js.SafeInteger(rawAmount) || rawAmount.GetDouble() <= 0 || !Js.SafeInteger(rawAmount.GetDouble() * 100)) return new Reply("01", "Order not found");
                var orderRef = db.Collection("orders").Document(orderId); var orderSnapshot = await transaction.GetSnapshotAsync(orderRef, processingCancellation);
                if (!orderSnapshot.Exists) return new Reply("01", "Order not found");
                var order = orderSnapshot.ToDictionary();
                if (order.GetValueOrDefault("paymentMethod") is not "vnpay") return new Reply("01", "Order not found");
                if (Text(parameters, "vnp_TmnCode") != secrets.TmnCode) return new Reply("97", "Invalid signature");
                var amountText = Text(parameters, "vnp_Amount"); var amount = Js.Number(Js.Element(amountText)); var total = Js.Element(order.GetValueOrDefault("total"));
                if (!Is(parameters, "vnp_CurrCode", "VND") || !Regex.IsMatch(amountText, @"\A[0-9]+\z") || !Js.SafeInteger(amount)
                    || amount != rawAmount.GetDouble() * 100 || !Js.SafeInteger(total) || !Js.SafeInteger(total.GetDouble() * 100) || amount != total.GetDouble() * 100)
                    return new Reply("04", "Invalid amount");
                if (attempt.GetValueOrDefault("status") is "success") return new Reply("00", "Confirm Success");
                var paid = Is(parameters, "vnp_ResponseCode", "00") && Is(parameters, "vnp_TransactionStatus", "00");
                var late = paid && (order.GetValueOrDefault("inventoryReserved") is not true || order.GetValueOrDefault("status") is "Đã hủy");
                var changes = new Dictionary<string, object> { ["status"] = paid ? "success" : "failed", ["responseCode"] = Text(parameters, "vnp_ResponseCode"),
                    ["transactionStatus"] = Text(parameters, "vnp_TransactionStatus"), ["transactionNo"] = Js.Cut(Text(parameters, "vnp_TransactionNo"), 100), ["processedAt"] = FieldValue.ServerTimestamp };
                if (late) changes["latePayment"] = true;
                transaction.UpdateJs(attemptRef, changes);
                if (paid && order.GetValueOrDefault("paymentVerified") is not true)
                {
                    var payment = new Dictionary<string, object> { ["paymentStatus"] = "da_thanh_toan", ["paymentVerified"] = true,
                        ["paidAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                        ["vnpTransactionNo"] = Js.Cut(Text(parameters, "vnp_TransactionNo"), 100), ["vnpTxnRef"] = txnRef };
                    if (late) { payment["latePayment"] = true; payment["paymentAttention"] = "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."; }
                    transaction.UpdateJs(orderRef, payment);
                }
                else if (!paid && order.GetValueOrDefault("paymentVerified") is not true && order.GetValueOrDefault("vnpTxnRef") as string == txnRef)
                    transaction.UpdateJs(orderRef, new Dictionary<string, object> { ["paymentStatus"] = "that_bai", ["vnpResponseCode"] = Js.Cut(Text(parameters, "vnp_ResponseCode"), 10) });
                else if (paid && order.GetValueOrDefault("paymentVerified") is true)
                {
                    transaction.UpdateJs(attemptRef, new Dictionary<string, object> { ["latePayment"] = true });
                    transaction.UpdateJs(orderRef, new Dictionary<string, object> { ["latePayment"] = true,
                        ["paymentAttention"] = "Có thêm giao dịch VNPay thành công cho đơn đã thanh toán; cần kiểm tra và xử lý hoàn tiền." });
                }
                return new Reply("00", "Confirm Success");
            }, cancellationToken: processingCancellation);
            await IpnReplyAsync(context, result.Code, result.Message);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch { logger.LogError("VNPay IPN processing failed."); await IpnReplyAsync(context, "99", "Unknown error"); }
    }
}
