using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Orders;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Catalog;

/// <summary>Port of backend/catalog/flower-prices.js.</summary>
public sealed class FlowerPricesHandler(Func<FirestoreDb> database, FirebaseAdminService authentication, ILogger<FlowerPricesHandler> logger)
{
    public const int MinPrice = 1000;
    public const int MaxPrice = 1_000_000_000;
    public static bool ValidFlowerId(JsonElement value) => Js.IsString(value) && ValidFlowerId(value.GetString()!);
    public static bool ValidFlowerId(string value) => value.Trim() == value && value.Length is > 0 and <= 128
        && !Regex.IsMatch(value, @"[/\u0000-\u001f\u007f]");
    public static bool ValidPrice(JsonElement value) => Js.SafeInteger(value) && value.GetDouble() is >= MinPrice and <= MaxPrice;
    public static Dictionary<string, object> SerializeFlower(string id, Dictionary<string, object> data)
    {
        var changed = OrderTracking.SerializeTimestamp(data.GetValueOrDefault("priceChangedAt"));
        return new()
        {
            ["flowerId"] = id, ["name"] = Js.String(Js.Element(FirestoreValues.Or(data, "title"))),
            ["image"] = Js.String(Js.Element(FirestoreValues.Or(data, "image"))),
            ["unit"] = Js.String(Js.Element(FirestoreValues.Or(data, "unit", "cành"))),
            ["price"] = OrderPricing.ToVndPrice(Js.Element(data.GetValueOrDefault("price"))),
            ["priceUpdatedAt"] = changed.Length > 0 ? changed : Js.String(Js.Element(FirestoreValues.Or(data, "priceUpdatedAt"))),
            ["updatedBy"] = Js.String(Js.Element(FirestoreValues.Or(data, "priceUpdatedByEmail", FirestoreValues.Or(data, "priceUpdatedBy"))))
        };
    }

    public async Task<Dictionary<string, object>> UpdateFlowerPriceAsync(FirestoreDb db, FirebaseIdentity token, JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var flowerId = Js.Get(body, "flowerId"); var price = Js.Get(body, "price");
        static Dictionary<string, object> Error(string message, string code) => new() { ["error"] = message, ["code"] = code };
        if (!ValidFlowerId(flowerId) || !ValidPrice(price)) return Error("Mã hoa hoặc giá bán không hợp lệ.", "invalid-argument");
        var productRef = db.Collection("products").Document(flowerId.GetString()!); var historyRef = db.Collection("priceHistory").Document();
        var now = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var email = Js.Cut(Js.StringOrEmpty(Js.Element(token.Claims.GetValueOrDefault("email"))), 320);
        return await db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(productRef, cancellationToken);
            if (!snapshot.Exists || snapshot.ToDictionary().GetValueOrDefault("saleType") is not "flower") return Error("Không tìm thấy loại hoa.", "flower-not-found");
            var product = snapshot.ToDictionary(); var oldPrice = OrderPricing.ToVndPrice(Js.Element(product.GetValueOrDefault("price")));
            if (!Js.SafeInteger(oldPrice) || oldPrice is < MinPrice or > MaxPrice) return Error("Giá hiện tại của loại hoa không hợp lệ.", "invalid-current-price");
            if (oldPrice == price.GetDouble()) return new() { ["changed"] = false, ["flower"] = SerializeFlower(productRef.Id, product) };
            transaction.UpdateJs(productRef, new Dictionary<string, object> { ["price"] = price.GetDouble(),
                ["priceUpdatedAt"] = OrderValidation.VietnameseDate(now), ["priceChangedAt"] = FieldValue.ServerTimestamp, ["priceUpdatedBy"] = token.Uid });
            transaction.CreateJs(historyRef, new Dictionary<string, object> { ["flowerId"] = productRef.Id, ["oldPrice"] = oldPrice,
                ["newPrice"] = price.GetDouble(), ["updatedAt"] = FieldValue.ServerTimestamp, ["updatedBy"] = token.Uid, ["updatedByEmail"] = email });
            AdminAudit.AddAdminAudit(transaction, db, token, "flower-price.update", "flower", productRef.Id,
                new Dictionary<string, object> { ["oldPrice"] = oldPrice, ["newPrice"] = price.GetDouble() });
            var flower = SerializeFlower(productRef.Id, product); flower["price"] = price.GetDouble();
            flower["priceUpdatedAt"] = now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            flower["updatedBy"] = email.Length > 0 ? email : token.Uid;
            return new() { ["changed"] = true, ["flower"] = flower };
        }, cancellationToken: cancellationToken);
    }

    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        if (context.Request.Method is not ("GET" or "PATCH"))
        { context.Response.Headers.Allow = "GET, PATCH"; await Error(405, "method-not-allowed", "API chỉ chấp nhận GET hoặc PATCH."); return; }
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình."); return; }
        var token = await authentication.VerifyRequestAsync(context); if (token is null) return;
        if (!token.Claims.TryGetValue("role", out var claimRole) || claimRole is not "owner"
            || !token.Claims.TryGetValue("admin", out var admin) || admin is not true)
        { await Error(403, "permission-denied", "Chỉ chủ cửa hàng mới được quản lý giá hoa."); return; }
        try
        {
            var role = await db.Collection("adminRoles").Document(token.Uid).GetSnapshotAsync(context.RequestAborted);
            if (!role.Exists || role.ToDictionary().GetValueOrDefault("role") is not "owner")
            { await Error(403, "permission-denied", "Tài khoản không còn quyền Owner."); return; }
        }
        catch { logger.LogError("Flower price authorization failed."); await Error(503, "price-service-unavailable", "Chưa thể xác minh quyền quản lý giá."); return; }
        try
        {
            if (context.Request.Method == "GET")
            {
                if (context.Request.Query.TryGetValue("flowerId", out var queryId))
                {
                    if (queryId.Count != 1 || !ValidFlowerId(queryId[0]!)) { await Error(400, "invalid-argument", "Mã hoa không hợp lệ."); return; }
                    var flower = await db.Collection("products").Document(queryId[0]!).GetSnapshotAsync(context.RequestAborted);
                    if (!flower.Exists || flower.ToDictionary().GetValueOrDefault("saleType") is not "flower")
                    { await Error(404, "flower-not-found", "Không tìm thấy loại hoa."); return; }
                    var snapshots = await db.Collection("priceHistory").WhereEqualTo("flowerId", queryId[0]).GetSnapshotAsync(context.RequestAborted);
                    var history = snapshots.Documents.Select(document =>
                    {
                        var data = document.ToDictionary();
                        return new Dictionary<string, object> { ["id"] = document.Id, ["oldPrice"] = Js.Number(Js.Element(data.GetValueOrDefault("oldPrice"))),
                            ["newPrice"] = Js.Number(Js.Element(data.GetValueOrDefault("newPrice"))), ["updatedAt"] = OrderTracking.SerializeTimestamp(data.GetValueOrDefault("updatedAt")),
                            ["updatedBy"] = Js.String(Js.Element(FirestoreValues.Or(data, "updatedByEmail", FirestoreValues.Or(data, "updatedBy")))) };
                    }).OrderByDescending(item => DateTimeOffset.TryParse((string)item["updatedAt"], out var date) ? date : DateTimeOffset.MinValue).ToList();
                    await context.Response.WriteAsJsonAsync(new { history }, context.RequestAborted); return;
                }
                var snapshot = await db.Collection("products").WhereEqualTo("saleType", "flower").GetSnapshotAsync(context.RequestAborted);
                var comparer = StringComparer.Create(CultureInfo.GetCultureInfo("vi-VN"), false);
                var flowers = snapshot.Documents.Select(document => SerializeFlower(document.Id, document.ToDictionary())).OrderBy(item => (string)item["name"], comparer).ToList();
                await context.Response.WriteAsJsonAsync(new { flowers }, context.RequestAborted); return;
            }
            var result = await UpdateFlowerPriceAsync(db, token, await JsonInput.ReadAsync(context), context.RequestAborted);
            if (result.TryGetValue("error", out var message))
            { var code = (string)result["code"]; await Error(code == "flower-not-found" ? 404 : 400, code, (string)message); return; }
            await context.Response.WriteAsJsonAsync(result, context.RequestAborted);
        }
        catch { logger.LogError("Flower prices API failed."); await Error(503, "price-service-unavailable", "Chưa thể tải hoặc cập nhật giá hoa. Vui lòng thử lại."); }
    }
}
