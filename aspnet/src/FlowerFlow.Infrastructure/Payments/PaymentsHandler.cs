using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Application.Payments;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Orders;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Payments;

public sealed record PaymentAttempt(string TxnRef, object? Amount, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt);

/// <summary>Port of backend/payments/payments.js. Reuses pending attempts and restores retry stock transactionally.</summary>
public sealed class PaymentsHandler(Func<FirestoreDb> database, Reservations reservations, ILogger<PaymentsHandler> logger,
    Func<string, string?>? environment = null)
{
    public const int PaymentReservationMs = 15 * 60 * 1000;
    private static bool ValidTxnRef(string value) => Regex.IsMatch(value, @"\A[a-f0-9]{32}\z");
    private static string Iso(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private static Task Error(HttpContext context, int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);

    public async Task<PaymentAttempt> CreateOrReuseAttemptAsync(FirestoreDb db, string orderId, string paymentReference,
        string previousTxnRef = "", CancellationToken cancellationToken = default)
    {
        await reservations.ExpireReservationsAsync(db, cancellationToken: cancellationToken);
        var orderRef = db.Collection("orders").Document(orderId);
        var previousRef = previousTxnRef.Length > 0 ? db.Collection("paymentTransactions").Document(previousTxnRef) : null;
        return await db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(orderRef, cancellationToken);
            if (!snapshot.Exists) throw new BackendException("order-not-found", "Không tìm thấy đơn hàng.");
            var order = snapshot.ToDictionary();
            if (previousRef is not null)
            {
                var previous = await transaction.GetSnapshotAsync(previousRef, cancellationToken);
                if (!previous.Exists || previous.ToDictionary().GetValueOrDefault("orderId") as string != orderId)
                    throw new BackendException("order-not-found", "Không tìm thấy giao dịch thanh toán.");
            }
            else if (order.GetValueOrDefault("paymentReference") as string != paymentReference)
                throw new BackendException("order-not-found", "Không tìm thấy giao dịch thanh toán.");
            if (order.GetValueOrDefault("paymentMethod") is not "vnpay") throw new BackendException("payment-not-available", "Đơn hàng này không sử dụng thanh toán VNPay.");
            if (order.GetValueOrDefault("paymentVerified") is true) throw new BackendException("payment-already-complete", "Đơn hàng đã được xác nhận thanh toán.");
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); var currentId = Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("vnpTxnRef")));
            if (currentId.Length > 0)
            {
                var currentRef = currentId == previousTxnRef ? previousRef! : db.Collection("paymentTransactions").Document(currentId);
                var currentSnapshot = await transaction.GetSnapshotAsync(currentRef, cancellationToken);
                var current = currentSnapshot.Exists ? currentSnapshot.ToDictionary() : null;
                var expiry = current?.GetValueOrDefault("expiresAt") is Timestamp timestamp ? FirestoreValues.ToMillis(timestamp) : 0;
                var reservation = order.GetValueOrDefault("reservationExpiresAt") is Timestamp reserved ? FirestoreValues.ToMillis(reserved) : 0;
                if (current?.GetValueOrDefault("status") is "pending" && expiry > now && order.GetValueOrDefault("inventoryReserved") is true && reservation > now)
                    return new PaymentAttempt(currentId, current.GetValueOrDefault("amount"), current.GetValueOrDefault("createdAt") is Timestamp created
                        ? FirestoreValues.ToDate(created) : DateTimeOffset.FromUnixTimeMilliseconds(now), FirestoreValues.ToDate((Timestamp)current["expiresAt"]));
            }
            var items = OrderPricing.AggregateItems(Js.Element(order.GetValueOrDefault("items"))); var total = Js.Element(order.GetValueOrDefault("total"));
            if (items.Count == 0 || !Js.SafeInteger(total) || !Js.SafeInteger(total.GetDouble() * 100) || total.GetDouble() <= 0)
                throw new BackendException("invalid-payment", "Đơn hàng không có số tiền thanh toán hợp lệ.");
            var wasReserved = order.GetValueOrDefault("inventoryReserved") is true;
            if (!wasReserved && !(order.GetValueOrDefault("status") is "Đã hủy" && order.GetValueOrDefault("paymentStatus") is "that_bai"
                && FirestoreValues.Truthy(order.GetValueOrDefault("reservationExpiredAt"))))
                throw new BackendException("payment-not-available", "Đơn hàng không còn ở trạng thái có thể thanh toán.");
            var refs = wasReserved ? [] : items.Select(item => db.Collection("products").Document((string)item["id"])).ToList();
            var products = refs.Count > 0 ? await transaction.GetAllSnapshotsAsync(refs, cancellationToken) : [];
            for (var index = 0; index < products.Count; index++)
            {
                var available = products[index].Exists ? Js.Number(Js.Element(products[index].ToDictionary().GetValueOrDefault("quantity"))) : 0;
                if (!Js.Integer(available) || available < Convert.ToDouble(items[index]["quantity"], CultureInfo.InvariantCulture))
                    throw new BackendException("insufficient-stock", "Một số sản phẩm đã hết hàng. Hãy quay lại giỏ hàng để cập nhật đơn.");
            }
            var txnRef = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)); var createdAt = DateTimeOffset.FromUnixTimeMilliseconds(now);
            var expiresAt = wasReserved && order.GetValueOrDefault("reservationExpiresAt") is Timestamp hold && FirestoreValues.ToMillis(hold) > now
                ? FirestoreValues.ToDate(hold) : DateTimeOffset.FromUnixTimeMilliseconds(now + PaymentReservationMs);
            var attemptNumber = Math.Max(0, Js.NumberOrZero(Js.Element(order.GetValueOrDefault("vnpPaymentAttempt")))) + 1;
            var attemptRef = db.Collection("paymentTransactions").Document(txnRef);
            if (!wasReserved)
                for (var index = 0; index < products.Count; index++) transaction.Update(products[index].Reference, new Dictionary<string, object>
                { ["quantity"] = Js.Number(Js.Element(products[index].ToDictionary().GetValueOrDefault("quantity"))) - Convert.ToDouble(items[index]["quantity"], CultureInfo.InvariantCulture) });
            transaction.Create(attemptRef, new Dictionary<string, object> { ["orderId"] = orderId, ["amount"] = order["total"], ["status"] = "pending", ["attempt"] = attemptNumber,
                ["createdAt"] = Timestamp.FromDateTime(createdAt.UtcDateTime), ["expiresAt"] = Timestamp.FromDateTime(expiresAt.UtcDateTime) });
            var changes = new Dictionary<string, object>();
            if (!wasReserved)
            {
                var history = order.GetValueOrDefault("trackingHistory") is IEnumerable<object> values ? values.ToList() : [];
                history.Add(new Dictionary<string, object> { ["status"] = "Chờ xác nhận", ["location"] = "Đơn hàng đang chờ thanh toán lại", ["estimatedDelivery"] = "", ["updatedAt"] = Iso(createdAt) });
                changes["status"] = "Chờ xác nhận"; changes["currentLocation"] = "Đơn hàng đang chờ thanh toán lại"; changes["inventoryReserved"] = true;
                changes["inventoryState"] = "reserved"; changes["reservationExpiresAt"] = Timestamp.FromDateTime(expiresAt.UtcDateTime); changes["reservationExpiredAt"] = FieldValue.Delete; changes["trackingHistory"] = history;
            }
            changes["paymentStatus"] = "chua_thanh_toan"; changes["vnpTxnRef"] = txnRef; changes["vnpPaymentAttempt"] = attemptNumber; changes["vnpPaymentCreatedAt"] = FieldValue.ServerTimestamp;
            transaction.Update(orderRef, changes); return new PaymentAttempt(txnRef, order["total"], createdAt, expiresAt);
        }, cancellationToken: cancellationToken);
    }

    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method == "GET" && context.Request.Query["action"].ToString() == "status") { await GetStatusAsync(context); return; }
        if (context.Request.Method == "POST")
        {
            var body = await JsonInput.ReadAsync(context); var action = Js.Get(body, "action");
            if (Js.IsString(action) && action.GetString() is "create" or "retry") { await CreateLinkAsync(context, body, action.GetString() == "retry"); return; }
        }
        context.Response.Headers.Allow = "GET, POST";
        await Error(context, 405, "method-not-allowed", "API thanh toán chỉ chấp nhận GET hoặc POST.");
    }
    private async Task CreateLinkAsync(HttpContext context, JsonElement body, bool retry)
    {
        try
        {
            var config = Vnpay.GetConfig(environment); var previousTxnRef = retry ? Js.StringOrEmpty(Js.Get(body, "txnRef")) : "";
            if (retry && !ValidTxnRef(previousTxnRef)) throw new BackendException("invalid-payment", "Mã giao dịch thanh toán không hợp lệ.");
            var orderId = retry ? "" : Js.StringOrEmpty(Js.Get(body, "orderId")).Trim(); var reference = retry ? "" : Js.StringOrEmpty(Js.Get(body, "paymentReference")).Trim();
            if (!retry && (orderId.Length is < 1 or > 128 || orderId.Contains('/') || reference.Length is < 1 or > 64))
                throw new BackendException("invalid-payment", "Thông tin đơn hàng không hợp lệ.");
            var db = database();
            if (retry)
            {
                var previous = await db.Collection("paymentTransactions").Document(previousTxnRef).GetSnapshotAsync(context.RequestAborted);
                if (!previous.Exists) throw new BackendException("order-not-found", "Không tìm thấy giao dịch thanh toán.");
                orderId = Js.StringOrEmpty(Js.Element(previous.ToDictionary().GetValueOrDefault("orderId")));
            }
            var attempt = await CreateOrReuseAttemptAsync(db, orderId, reference, previousTxnRef, context.RequestAborted);
            var rawAmount = Js.Element(attempt.Amount);
            if (!Js.SafeInteger(rawAmount)) throw new VnpayException("invalid-payment", "Thông tin giao dịch VNPay không hợp lệ.");
            var ip = context.Request.Headers["x-forwarded-for"].ToString().Split(',')[0].Trim();
            if (ip.Length == 0) ip = context.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
            var url = Vnpay.CreatePaymentUrl(attempt.TxnRef, rawAmount.GetDouble(), ip, attempt.CreatedAt, attempt.ExpiresAt, config);
            await context.Response.WriteAsJsonAsync(new { paymentUrl = url, expiresAt = Iso(attempt.ExpiresAt) }, context.RequestAborted);
        }
        catch (Exception error)
        {
            var code = error is BackendException business ? business.Code : error is VnpayException vnpay ? vnpay.Code : "";
            if (new[] { "invalid-payment", "order-not-found", "payment-not-available", "payment-already-complete", "insufficient-stock" }.Contains(code))
            { await Error(context, code == "order-not-found" ? 404 : code == "invalid-payment" ? 400 : 409, code, error.Message); return; }
            if (code == "vnpay-not-configured")
            { await Error(context, 503, code, "Thanh toán VNPay chưa được cấu hình. Vui lòng chọn thanh toán khi nhận hàng hoặc thử lại sau."); return; }
            logger.LogError("VNPay payment request failed."); await Error(context, 503, "payment-service-unavailable", "Chưa thể tạo liên kết thanh toán. Vui lòng thử lại sau.");
        }
    }
    private async Task GetStatusAsync(HttpContext context)
    {
        var id = context.Request.Query["txnRef"].ToString();
        if (!ValidTxnRef(id)) { await Error(context, 400, "invalid-payment", "Mã giao dịch thanh toán không hợp lệ."); return; }
        try
        {
            var snapshot = await database().Collection("paymentTransactions").Document(id).GetSnapshotAsync(context.RequestAborted);
            if (!snapshot.Exists) { await Error(context, 404, "payment-not-found", "Không tìm thấy giao dịch thanh toán."); return; }
            var payment = snapshot.ToDictionary(); var expired = payment.GetValueOrDefault("status") is "pending"
                && payment.GetValueOrDefault("expiresAt") is Timestamp expiry && FirestoreValues.ToMillis(expiry) <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var result = new Dictionary<string, object>();
            if (expired) result["status"] = "expired"; else if (payment.TryGetValue("status", out var status)) result["status"] = status;
            if (payment.TryGetValue("orderId", out var orderId)) result["orderId"] = orderId;
            result["retryAllowed"] = payment.GetValueOrDefault("status") is not "success"; result["latePayment"] = payment.GetValueOrDefault("latePayment") is true;
            await context.Response.WriteAsJsonAsync(result, context.RequestAborted);
        }
        catch { logger.LogError("VNPay payment status lookup failed."); await Error(context, 503, "payment-service-unavailable", "Chưa thể kiểm tra trạng thái thanh toán."); }
    }
}
