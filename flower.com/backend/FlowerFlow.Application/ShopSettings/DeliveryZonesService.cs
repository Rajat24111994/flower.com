using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Application.ShopSettings;

/// <summary>Port of backend/shop-settings/delivery-zones.js.</summary>
public sealed class DeliveryZonesService(Func<FirestoreDb> database, IFirebaseAuthService authentication,
    BouquetWrappingService wrapping, ILogger<DeliveryZonesService> logger, IAdminAuditRepository audit)
{
    public const string ZonesDocument = "deliveryZones";
    private sealed class DuplicateAreaException : Exception;

    public static Dictionary<string, object>? ValidZone(JsonElement zone)
    {
        if (zone.ValueKind != JsonValueKind.Object) return null;
        var id = Js.StringOrEmpty(Js.Get(zone, "id")).Trim();
        var province = Js.StringOrEmpty(Js.Get(zone, "province")).Trim();
        var district = Js.StringOrEmpty(Js.Get(zone, "district")).Trim();
        var fee = Js.Get(zone, "fee"); var enabled = Js.Get(zone, "enabled");
        if (!Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,80}\z") || province.Length is < 1 or > 120 || district.Length is < 1 or > 120
            || !Js.SafeInteger(fee) || fee.GetDouble() is < 0 or > 1_000_000_000
            || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
        return new() { ["id"] = id, ["province"] = province, ["district"] = district, ["fee"] = (long)fee.GetDouble(), ["enabled"] = enabled.GetBoolean() };
    }

    public static bool HasDuplicateAreas(IEnumerable<Dictionary<string, object>> zones)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal); var culture = CultureInfo.GetCultureInfo("vi-VN");
        return zones.Any(zone => !seen.Add(((string)zone["province"]).ToLower(culture) + "\0" + ((string)zone["district"]).ToLower(culture)));
    }

    public Task HandleAsync(HttpContext context) => new ApiRoutes(HandleDefaultAsync,
        new Dictionary<string, RequestDelegate> { ["bouquet-wrapping"] = wrapping.HandleAsync }).InvokeAsync(context);

    private static List<Dictionary<string, object>> ReadZones(object? data)
    {
        var zones = JsonInput.Property(JsonSerializer.SerializeToElement(data), "zones");
        return zones.ValueKind == JsonValueKind.Array ? zones.EnumerateArray().Select(ValidZone).OfType<Dictionary<string, object>>().ToList() : [];
    }

    private async Task HandleDefaultAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        Task Error(int status, string code, string message) => ApiResponse.SendErrorAsync(context, status, code, message);
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API quản trị dữ liệu giao hàng chưa được cấu hình."); return; }
        if (context.Request.Method == "GET")
        {
            var manage = context.Request.Query["manage"].ToString() == "1";
            if (manage && await authentication.VerifyAdminRequestAsync(context) is null) return;
            try
            {
                var snapshot = await db.Collection(FirestoreCollections.Metadata).Document(ZonesDocument).GetSnapshotAsync(context.RequestAborted);
                var zones = ReadZones(snapshot.ToDictionary());
                await context.Response.WriteAsJsonAsync(new { configured = zones.Any(zone => (bool)zone["enabled"]),
                    zones = manage ? zones : zones.Where(zone => (bool)zone["enabled"]).ToList() }, context.RequestAborted);
            }
            catch { logger.LogError("Delivery-zone read failed."); await Error(503, "delivery-zone-service-unavailable", "Chưa thể tải khu vực giao hàng."); }
            return;
        }
        if (context.Request.Method != "POST")
        {
            context.Response.Headers.Allow = "GET, POST";
            await Error(405, "method-not-allowed", "API khu vực giao hàng chỉ chấp nhận GET hoặc POST."); return;
        }
        var claims = await authentication.VerifyAdminRequestAsync(context);
        if (claims is null) return;
        var body = await JsonInput.ReadAsync(context); var action = Js.Get(body, "action");
        if (!Js.IsString(action) || action.GetString() is not ("upsert" or "delete"))
        { await Error(400, "invalid-delivery-zone", "Thao tác khu vực giao hàng không hợp lệ."); return; }
        var upsert = action.GetString() == "upsert";
        var zone = upsert ? ValidZone(Js.Get(body, "zone")) : null;
        var zoneId = upsert ? zone?.GetValueOrDefault("id") as string : Js.StringOrEmpty(Js.Get(body, "id")).Trim();
        if (string.IsNullOrEmpty(zoneId) || !Regex.IsMatch(zoneId, @"\A[A-Za-z0-9_-]{1,80}\z") || (upsert && zone is null))
        { await Error(400, "invalid-delivery-zone", "Vui lòng nhập tên tỉnh/thành, quận/huyện và phí giao hợp lệ."); return; }
        try
        {
            var reference = db.Collection(FirestoreCollections.Metadata).Document(ZonesDocument);
            var zones = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted);
                var current = ReadZones(snapshot.ToDictionary());
                var next = current.Where(item => (string)item["id"] != zoneId).ToList();
                if (upsert) next.Add(zone!);
                if (HasDuplicateAreas(next)) throw new DuplicateAreaException();
                transaction.SetJs(reference, new Dictionary<string, object> { ["zones"] = next, ["updatedAt"] = FieldValue.ServerTimestamp });
                audit.AddAdminAudit(transaction, db, claims, "delivery-zone." + action.GetString(), "delivery-zone", zoneId,
                    new Dictionary<string, object> { ["before"] = current.FirstOrDefault(item => (string)item["id"] == zoneId)!,
                        ["after"] = next.FirstOrDefault(item => (string)item["id"] == zoneId)! });
                return next;
            }, cancellationToken: context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { configured = zones.Any(item => (bool)item["enabled"]), zones }, context.RequestAborted);
        }
        catch (DuplicateAreaException) { await Error(409, "duplicate-delivery-zone", "Khu vực tỉnh/thành và quận/huyện này đã được khai báo."); }
        catch { logger.LogError("Delivery-zone update failed."); await Error(503, "delivery-zone-service-unavailable", "Chưa thể lưu khu vực giao hàng. Vui lòng thử lại."); }
    }
}
