using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Orders;

public sealed record OrderLookupLimit(bool Allowed, int RetryAfter);

/// <summary>Port of backend/orders/tracking.js.</summary>
public sealed class OrderTracking(Func<FirestoreDb> database, RequestIdentity identity, ILogger<OrderTracking> logger, Func<long>? clock = null)
{
    private readonly Func<long> _now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    public static string SerializeTimestamp(object? value) => value is Timestamp timestamp ? FirestoreValues.ToIso(timestamp) : value as string ?? "";
    public static bool AwaitsQrTransfer(Dictionary<string, object> data) => data.GetValueOrDefault("paymentMethod") is "qr"
        && data.GetValueOrDefault("paymentVerified") is not true && FirestoreValues.Or(data, "status", "Chờ xác nhận") is string status
        && status is "Chờ xác nhận" or "Đang chuẩn bị";

    public static Dictionary<string, object> PublicTrackingOrder(string id, Dictionary<string, object> data)
    {
        var history = data.GetValueOrDefault("trackingHistory") is IEnumerable<object> events ? events.Select(item =>
        {
            var entry = (Dictionary<string, object>)item;
            return new Dictionary<string, object>
            {
                ["status"] = FirestoreValues.Or(entry, "status", FirestoreValues.Or(data, "status", "Chờ xác nhận")),
                ["estimatedDelivery"] = FirestoreValues.Or(entry, "estimatedDelivery"),
                ["updatedAt"] = SerializeOrOriginal(entry, "updatedAt")
            };
        }).ToList() : [];
        var result = new Dictionary<string, object>
        {
            ["id"] = id, ["status"] = FirestoreValues.Or(data, "status", "Chờ xác nhận"),
            ["estimatedDelivery"] = FirestoreValues.Or(data, "estimatedDelivery"), ["trackingHistory"] = history
        };
        if (data.GetValueOrDefault("paymentRefunded") is true)
        { result["paymentMethod"] = FirestoreValues.Or(data, "paymentMethod"); result["paymentStatus"] = "Đã hoàn tiền"; }
        else if (AwaitsQrTransfer(data))
        {
            result["paymentMethod"] = "qr"; result["paymentStatus"] = FirestoreValues.Or(data, "paymentStatus", "Chờ xác minh thanh toán");
            result["total"] = Js.NumberOrZero(Js.Element(data.GetValueOrDefault("total")));
            result["wrappingFee"] = Js.NumberOrZero(Js.Element(data.GetValueOrDefault("wrappingFee")));
            result["paymentReference"] = FirestoreValues.Or(data, "paymentReference");
            result["reservationExpiresAt"] = SerializeTimestamp(data.GetValueOrDefault("reservationExpiresAt"));
        }
        else if (data.GetValueOrDefault("paymentMethod") is "vnpay")
        { result["paymentMethod"] = "vnpay"; result["paymentStatus"] = FirestoreValues.Or(data, "paymentStatus", "chua_thanh_toan"); }
        result["privacyLimited"] = true; return result;
    }

    public static Dictionary<string, object> AccountTrackingOrder(string id, Dictionary<string, object> data)
    {
        var result = new Dictionary<string, object>(data) { ["id"] = id, ["createdAt"] = SerializeOrOriginal(data, "createdAt"),
            ["reservationExpiresAt"] = SerializeOrOriginal(data, "reservationExpiresAt") };
        result["trackingHistory"] = data.GetValueOrDefault("trackingHistory") is IEnumerable<object> history
            ? history.Select(item => { var entry = new Dictionary<string, object>((Dictionary<string, object>)item);
                entry["updatedAt"] = SerializeOrOriginal(entry, "updatedAt"); return entry; }).ToList() : new List<object>();
        return result;
    }
    private static object SerializeOrOriginal(Dictionary<string, object> data, string key)
    { var text = SerializeTimestamp(data.GetValueOrDefault(key)); return text.Length > 0 ? text : FirestoreValues.Or(data, key); }

    public Task<OrderLookupLimit> CheckOrderLookupLimitAsync(FirestoreDb db, HttpContext context)
    {
        var ip = context.Request.Headers["x-forwarded-for"].ToString().Split(',')[0].Trim();
        if (ip.Length is < 1 or > 64) throw new InvalidOperationException("Trusted client IP is unavailable for order lookup rate limiting.");
        var secret = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");
        if (string.IsNullOrEmpty(secret)) throw new InvalidOperationException("Firebase service credentials are required for order lookup rate limiting.");
        var key = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(ip)));
        var reference = db.Collection("orderLookupLimits").Document(key); var millis = _now(); var now = FirestoreValues.FromMillis(millis);
        return db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted);
            var record = snapshot.Exists ? snapshot.ToDictionary() : new Dictionary<string, object>();
            var started = record.GetValueOrDefault("windowStartedAt") is Timestamp timestamp ? FirestoreValues.ToMillis(timestamp) : 0;
            var same = millis - started < OrderConfig.OrderLookupWindowMs;
            var attempts = same ? Js.NumberOrZero(Js.Element(record.GetValueOrDefault("attempts"))) : 0;
            if (attempts >= OrderConfig.OrderLookupMaxAttempts)
                return new OrderLookupLimit(false, Math.Max(1, (int)Math.Ceiling((started + OrderConfig.OrderLookupWindowMs - millis) / 1000d)));
            transaction.Set(reference, new Dictionary<string, object> { ["windowStartedAt"] = same ? record["windowStartedAt"] : now,
                ["attempts"] = attempts + 1, ["expiresAt"] = FirestoreValues.FromMillis(millis + 24 * 60 * 60 * 1000L) });
            return new OrderLookupLimit(true, 0);
        }, cancellationToken: context.RequestAborted);
    }
    public Task<FirebaseIdentity?> OptionalAuthenticatedUserAsync(HttpContext context) => identity.OptionalCustomerAsync(context);

    public async Task LookupOrderAsync(HttpContext context)
    {
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        try
        {
            var db = database(); var limit = await CheckOrderLookupLimitAsync(db, context);
            if (!limit.Allowed)
            { context.Response.Headers.RetryAfter = limit.RetryAfter.ToString(); await Error(429, "rate-limited", "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau."); return; }
            var authorization = context.Request.Headers.Authorization.ToString().Trim(); FirebaseIdentity? user = null;
            if (authorization.Length > 0 || RequestIdentity.HasLocalIdentity(context))
            {
                if (authorization.Length > 0 && !Regex.IsMatch(authorization, @"^Bearer\s+\S+$", RegexOptions.IgnoreCase))
                { await Error(401, "unauthenticated", "Phiên đăng nhập không hợp lệ."); return; }
                try { user = await OptionalAuthenticatedUserAsync(context); }
                catch (RequestIdentityException error) when (error.Code.StartsWith("auth/", StringComparison.Ordinal))
                { await Error(401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."); return; }
                catch { logger.LogError("Order lookup authentication failed."); await Error(503, "order-service-unavailable", "Chưa thể xác minh phiên đăng nhập. Vui lòng thử lại."); return; }
            }
            var body = await JsonInput.ReadAsync(context); var id = Regex.Replace(Js.StringOrEmpty(Js.Get(body, "id")).Trim(), "^#", "");
            var phone = OrderValidation.NormalizePhone(Js.Get(body, "phone"));
            if (id.Length is < 1 or > 128 || id.Contains('/') || user is null && phone.Length is < 8 or > 15)
            { await Error(400, "invalid-argument", "Mã đơn hàng hoặc số điện thoại không hợp lệ."); return; }
            var snapshot = await db.Collection("orders").Document(id).GetSnapshotAsync(context.RequestAborted);
            const string missing = "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại.";
            if (!snapshot.Exists) { await Error(404, "order-not-found", missing); return; }
            var data = snapshot.ToDictionary();
            if (user is not null)
            {
                if (data.GetValueOrDefault("uid") as string != user.Uid)
                { await Error(404, "order-not-found", "Không tìm thấy đơn hàng trong tài khoản."); return; }
                await context.Response.WriteAsJsonAsync(new { order = FirestoreValues.JsonCompatible(AccountTrackingOrder(snapshot.Id, data)) }, context.RequestAborted); return;
            }
            if (OrderValidation.NormalizePhone(Js.Element(data.GetValueOrDefault("phone"))) != phone)
            { await Error(404, "order-not-found", missing); return; }
            await context.Response.WriteAsJsonAsync(new { order = FirestoreValues.JsonCompatible(PublicTrackingOrder(snapshot.Id, data)) }, context.RequestAborted);
        }
        catch { logger.LogError("Order lookup failed."); await Error(503, "order-service-unavailable", "Chưa thể tra cứu đơn hàng. Vui lòng thử lại sau."); }
    }
    public async Task AccountOrdersAsync(HttpContext context)
    {
        try
        {
            var user = await OptionalAuthenticatedUserAsync(context);
            if (user is null) { await FirebaseAdminService.SendErrorAsync(context, 401, "unauthenticated", "Đăng nhập để xem đơn hàng."); return; }
            var snapshot = await database().Collection("orders").WhereEqualTo("uid", user.Uid).OrderByDescending("createdAt").Limit(100).GetSnapshotAsync(context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { accountUid = user.Uid, orders = snapshot.Documents.Select(document =>
                FirestoreValues.JsonCompatible(AccountTrackingOrder(document.Id, document.ToDictionary()))).ToList() }, context.RequestAborted);
        }
        catch (RequestIdentityException error) when (error.Code.StartsWith("auth/", StringComparison.Ordinal))
        { await FirebaseAdminService.SendErrorAsync(context, 401, "unauthenticated", "Phiên đăng nhập hết hạn."); }
        catch { await FirebaseAdminService.SendErrorAsync(context, 503, "order-service-unavailable", "Chưa thể tải danh sách đơn hàng."); }
    }
}
