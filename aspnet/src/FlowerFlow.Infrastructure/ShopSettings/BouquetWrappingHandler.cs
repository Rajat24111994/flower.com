using System.Text.Json;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.ShopSettings;

/// <summary>Port of backend/shop-settings/bouquet-wrapping.js.</summary>
public sealed class BouquetWrappingHandler(Func<FirestoreDb> database, FirebaseAdminService authentication,
    ILogger<BouquetWrappingHandler> logger)
{
    public const string WrappingDocument = "bouquetWrapping";
    public static IReadOnlyList<BouquetTier> ReadTiers(object? data) => BouquetWrapping.NormalizeTiers(
        JsonInput.Property(JsonSerializer.SerializeToElement(data), "tiers")) ?? [];

    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API cấu hình phí bó hoa chưa được thiết lập."); return; }
        if (context.Request.Method == "GET")
        {
            if (context.Request.Query["manage"].ToString() == "1" && await authentication.VerifyAdminRequestAsync(context) is null) return;
            try
            {
                var snapshot = await db.Collection("metadata").Document(WrappingDocument).GetSnapshotAsync(context.RequestAborted);
                var tiers = ReadTiers(snapshot.ToDictionary());
                await context.Response.WriteAsJsonAsync(new { configured = tiers.Count > 0, tiers }, context.RequestAborted);
            }
            catch { logger.LogError("Bouquet wrapping read failed."); await Error(503, "bouquet-wrapping-unavailable", "Chưa thể tải cấu hình phí bó hoa."); }
            return;
        }
        if (context.Request.Method != "POST")
        {
            context.Response.Headers.Allow = "GET, POST";
            await Error(405, "method-not-allowed", "API phí bó hoa chỉ chấp nhận GET hoặc POST."); return;
        }
        var claims = await authentication.VerifyAdminRequestAsync(context);
        if (claims is null) return;
        var normalized = BouquetWrapping.NormalizeTiers(JsonInput.Property(await JsonInput.ReadAsync(context), "tiers"));
        if (normalized is null)
        {
            await Error(400, "invalid-bouquet-wrapping", "Bậc phí phải tăng dần theo số cành, mức cuối phải áp dụng đến 50 cành; phí là số nguyên VND không âm."); return;
        }
        try
        {
            var tiers = normalized.Select(tier => tier.ToData()).ToList();
            await db.RunTransactionAsync(async transaction =>
            {
                var reference = db.Collection("metadata").Document(WrappingDocument);
                var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted);
                var previous = ReadTiers(snapshot.ToDictionary()).Select(tier => tier.ToData()).ToList();
                transaction.Set(reference, new Dictionary<string, object> { ["tiers"] = tiers, ["updatedAt"] = FieldValue.ServerTimestamp });
                AdminAudit.AddAdminAudit(transaction, db, claims, "bouquet-wrapping.update", "bouquet-wrapping", WrappingDocument,
                    new Dictionary<string, object> { ["before"] = previous, ["after"] = tiers });
                return 0;
            }, cancellationToken: context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { configured = true, tiers }, context.RequestAborted);
        }
        catch { logger.LogError("Bouquet wrapping update failed."); await Error(503, "bouquet-wrapping-unavailable", "Chưa thể lưu cấu hình phí bó hoa. Vui lòng thử lại."); }
    }
}
