using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Orders;

/// <summary>Port of backend/orders/payment-admin.js: manual bank reconciliation and refunds, not gateway refund execution.</summary>
public sealed class PaymentAdmin(Func<FirestoreDb> database, FirebaseAdminService authentication, ILogger<PaymentAdmin> logger)
{
    private static bool ValidOrderId(string id) => id.Length is > 0 and <= 128 && !id.Contains('/');
    private static bool ValidReference(string value) => value.Length is > 0 and <= 120 && !Regex.IsMatch(value, @"[\u0000-\u001f\u007f]");
    private static Task Error(HttpContext context, int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
    public async Task<FirebaseIdentity?> AuthorizeOrderAdminAsync(HttpContext context)
    {
        var db = database(); var user = await authentication.VerifyRequestAsync(context); if (user is null) return null;
        if (!user.Claims.TryGetValue("admin", out var admin) || admin is not true)
        { await Error(context, 403, "forbidden", "Thao tác này chỉ dành cho quản trị viên."); return null; }
        var role = await db.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync(context.RequestAborted);
        if (!role.Exists) { await Error(context, 403, "forbidden", "Quyền quản trị viên đã bị thu hồi."); return null; }
        return user;
    }

    private static Dictionary<string, object> AuditData(string orderId, string action, FirebaseIdentity user,
        Dictionary<string, object> order, string reference) => new()
    {
        ["orderId"] = orderId, ["action"] = action, ["actorUid"] = user.Uid,
        ["actorEmail"] = Js.Cut(Js.StringOrEmpty(Js.Element(user.Claims.GetValueOrDefault("email"))), 254), ["actorRole"] = "admin",
        ["amountVnd"] = order["total"], ["paymentReference"] = Js.Cut(Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("paymentReference"))), 120),
        ["reconciliationReference"] = reference, ["previousPaymentStatus"] = Js.Cut(Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("paymentStatus"))), 120),
        ["orderStatus"] = Js.Cut(Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("status"))), 80), ["createdAt"] = FieldValue.ServerTimestamp
    };

    public async Task ReconcileQrPaymentAsync(HttpContext context, bool latePayment = false)
    {
        var body = await JsonInput.ReadAsync(context); var id = Js.StringOrEmpty(Js.Get(body, "orderId")).Trim();
        var reference = Js.StringOrEmpty(Js.Get(body, "reconciliationReference")).Trim(); var amount = Js.Number(Js.Get(body, "amount"));
        if (!ValidOrderId(id) || !ValidReference(reference) || !Js.SafeInteger(amount) || amount <= 0)
        { await Error(context, 400, "invalid-argument", "Cần mã đơn, mã giao dịch ngân hàng và số tiền đã đối chiếu hợp lệ."); return; }
        try
        {
            var user = await AuthorizeOrderAdminAsync(context); if (user is null) return;
            var db = database(); var orderRef = db.Collection("orders").Document(id); var auditRef = db.Collection("orderPaymentAudit").Document();
            await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(orderRef, context.RequestAborted);
                if (!snapshot.Exists) throw new BackendException("order-not-found", "Không tìm thấy đơn hàng.");
                var order = snapshot.ToDictionary();
                if (order.GetValueOrDefault("paymentMethod") is not "qr") throw new BackendException("payment-method-mismatch", "Đơn hàng này không sử dụng chuyển khoản QR.");
                if (order.GetValueOrDefault("paymentVerified") is true) throw new BackendException("payment-already-complete", "Thanh toán của đơn này đã được xác nhận.");
                var total = Js.Element(order.GetValueOrDefault("total"));
                if (!Js.SafeInteger(total) || total.GetDouble() <= 0 || amount != total.GetDouble())
                    throw new BackendException("payment-amount-mismatch", "Số tiền đối chiếu không khớp tổng tiền đơn hàng.");
                if (latePayment ? order.GetValueOrDefault("status") is not "Đã hủy" : order.GetValueOrDefault("status") is "Đã hủy")
                    throw new BackendException(latePayment ? "order-not-cancelled" : "order-cancelled", latePayment
                        ? "Đơn này chưa bị hủy. Hãy dùng xác minh thanh toán thông thường." : "Đơn này đã bị hủy. Hãy dùng thao tác ghi nhận thanh toán trễ.");
                if (!latePayment && order.GetValueOrDefault("inventoryState") is "released")
                    throw new BackendException("order-inventory-released", "Đơn đã giải phóng tồn kho. Hãy khôi phục đơn trước khi xác nhận thanh toán.");
                var changes = new Dictionary<string, object>
                {
                    ["paymentVerified"] = true, ["paymentStatus"] = latePayment ? "Đã nhận tiền sau khi đơn bị hủy – cần khôi phục đơn hoặc hoàn tiền" : "Đã thanh toán",
                    ["paidAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture), ["paymentVerifiedAt"] = FieldValue.ServerTimestamp,
                    ["paymentVerifiedBy"] = user.Uid, ["paymentReconciliationReference"] = reference
                };
                if (latePayment) { changes["latePayment"] = true; changes["paymentAttention"] = "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."; }
                transaction.UpdateJs(orderRef, changes);
                transaction.CreateJs(auditRef, AuditData(id, latePayment ? "qr-late-payment-recorded" : "qr-payment-verified", user, order, reference));
                return 0;
            }, cancellationToken: context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { ok = true, auditId = auditRef.Id }, context.RequestAborted);
        }
        catch (Exception error)
        {
            await FailureAsync(context, error, ["order-not-found", "payment-method-mismatch", "payment-already-complete", "payment-amount-mismatch", "order-not-cancelled", "order-cancelled", "order-inventory-released"],
                "payment-reconciliation-unavailable", "Chưa thể ghi nhận đối soát. Vui lòng thử lại.");
        }
    }

    public async Task RecordPaymentRefundAsync(HttpContext context)
    {
        var body = await JsonInput.ReadAsync(context); var id = Js.StringOrEmpty(Js.Get(body, "orderId")).Trim();
        var reference = Js.StringOrEmpty(Js.Get(body, "refundReference")).Trim();
        if (!ValidOrderId(id) || !ValidReference(reference)) { await Error(context, 400, "invalid-argument", "Cần mã đơn và mã giao dịch hoàn tiền hợp lệ."); return; }
        try
        {
            var user = await AuthorizeOrderAdminAsync(context); if (user is null) return;
            var db = database(); var orderRef = db.Collection("orders").Document(id); var auditRef = db.Collection("orderPaymentAudit").Document();
            var amount = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(orderRef, context.RequestAborted);
                if (!snapshot.Exists) throw new BackendException("order-not-found", "Không tìm thấy đơn hàng.");
                var order = snapshot.ToDictionary();
                if (order.GetValueOrDefault("paymentRefunded") is true) throw new BackendException("payment-already-refunded", "Đơn hàng này đã được ghi nhận hoàn tiền.");
                var status = Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("paymentStatus"))).Trim().ToLower(CultureInfo.GetCultureInfo("vi-VN"));
                if (order.GetValueOrDefault("paymentVerified") is not true && !new[] { "đã thanh toán", "paid", "da_thanh_toan" }.Contains(status))
                    throw new BackendException("payment-not-complete", "Chỉ ghi nhận hoàn tiền cho đơn đã xác nhận thanh toán.");
                var total = Js.Element(order.GetValueOrDefault("total"));
                if (!Js.SafeInteger(total) || total.GetDouble() <= 0) throw new BackendException("invalid-refund-amount", "Tổng tiền đơn hàng không hợp lệ để hoàn tiền.");
                transaction.UpdateJs(orderRef, new Dictionary<string, object> { ["paymentRefunded"] = true, ["paymentRefundAmount"] = order["total"],
                    ["paymentRefundedAt"] = FieldValue.ServerTimestamp, ["paymentRefundedBy"] = user.Uid, ["paymentRefundReference"] = reference, ["paymentStatus"] = "Đã hoàn tiền" });
                transaction.CreateJs(auditRef, AuditData(id, "payment-refunded", user, order, reference)); return order["total"];
            }, cancellationToken: context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { ok = true, auditId = auditRef.Id, amountVnd = amount }, context.RequestAborted);
        }
        catch (Exception error) { await FailureAsync(context, error, ["order-not-found", "payment-not-complete", "payment-already-refunded", "invalid-refund-amount"],
            "payment-refund-unavailable", "Chưa thể ghi nhận hoàn tiền. Vui lòng thử lại."); }
    }

    public async Task GetQrPaymentAuditAsync(HttpContext context)
    {
        var id = context.Request.Query["orderId"].ToString().Trim();
        if (!ValidOrderId(id)) { await Error(context, 400, "invalid-argument", "Mã đơn không hợp lệ."); return; }
        try
        {
            if (await AuthorizeOrderAdminAsync(context) is null) return;
            var snapshot = await database().Collection("orderPaymentAudit").WhereEqualTo("orderId", id).OrderByDescending("createdAt").Limit(25).GetSnapshotAsync(context.RequestAborted);
            var entries = snapshot.Documents.Select(document =>
            {
                var data = document.ToDictionary(); var entry = new Dictionary<string, object> { ["id"] = document.Id };
                foreach (var key in new[] { "action", "actorUid", "actorEmail", "actorRole", "amountVnd", "paymentReference", "reconciliationReference", "previousPaymentStatus", "orderStatus" })
                    if (data.TryGetValue(key, out var value)) entry[key] = value;
                entry["createdAt"] = OrderTracking.SerializeTimestamp(data.GetValueOrDefault("createdAt")); return entry;
            }).ToList();
            await context.Response.WriteAsJsonAsync(new { entries }, context.RequestAborted);
        }
        catch (Exception error) { await FailureAsync(context, error, [], "payment-audit-unavailable", "Chưa thể tải lịch sử đối soát. Vui lòng thử lại."); }
    }

    private async Task FailureAsync(HttpContext context, Exception error, string[] known, string fallbackCode, string message)
    {
        if (error is RequestIdentityException identity && identity.Code.StartsWith("auth/", StringComparison.Ordinal))
        { await Error(context, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."); return; }
        if (error is BackendException failure && known.Contains(failure.Code))
        { await Error(context, failure.Code == "order-not-found" ? 404 : 409, failure.Code, failure.Message); return; }
        logger.LogError("Payment administration operation failed."); await Error(context, 503, fallbackCode, message);
    }
}
