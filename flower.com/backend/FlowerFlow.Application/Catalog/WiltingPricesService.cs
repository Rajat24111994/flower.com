using System.Text.Json;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Application.Catalog;

public sealed class WiltingPricesService(Func<FirestoreDb> database, IFirebaseAuthService authentication, ILogger<WiltingPricesService> logger, IAdminAuditRepository audit)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        if (context.Request.Method is not ("GET" or "POST"))
        {
            context.Response.Headers.Allow = "GET, POST";
            await ApiResponse.SendErrorAsync(context, 405, "method-not-allowed", "API giá héo chỉ chấp nhận GET hoặc POST."); return;
        }
        var owner = await authentication.VerifyOwnerRequestAsync(context); if (owner is null) return;
        try
        {
            var db = database();
            if (context.Request.Method == "GET")
            {
                var config = WiltingPriceStore.Read(await db.Document(WiltingPriceStore.Document).GetSnapshotAsync(context.RequestAborted));
                var snapshots = await db.Collection(Product.Collection).GetSnapshotAsync(context.RequestAborted);
                var fresh = await db.Collection(FirestoreCollections.ProductFreshness).GetSnapshotAsync(context.RequestAborted);
                var dates = fresh.Documents.ToDictionary(doc => doc.Id, doc => doc.ToDictionary().GetValueOrDefault("receivedDate") as string ?? "");
                var pricing = new WiltingPriceContext(config, dates, DateTimeOffset.UtcNow);
                var products = snapshots.Documents.Select(doc =>
                {
                    var data = doc.ToDictionary(); var price = pricing.Price(doc.Id, data);
                    return new { id = doc.Id, title = data.GetValueOrDefault("title") as string ?? doc.Id,
                        receivedDate = dates.GetValueOrDefault(doc.Id, ""), basePrice = Application.Orders.PricingService.GetProductPrice(Js.Element(data)),
                        effectivePrice = (double?)price?.Price ?? Application.Orders.PricingService.GetProductPrice(Js.Element(data)),
                        ruleId = price?.RuleId ?? "", quantity = data.GetValueOrDefault("quantity") ?? 0 };
                }).OrderBy(product => product.title, StringComparer.Ordinal).ToArray();
                await context.Response.WriteAsJsonAsync(new { settings = WiltingPriceStore.SettingsData(config), today = WiltingPricing.Today(), products }, context.RequestAborted); return;
            }
            var body = await JsonInput.ReadAsync(context); var action = Js.Get(body, "action");
            if (action.ValueKind != JsonValueKind.String || action.GetString() is not ("save-rules" or "set-received-date"))
                throw new BackendException("invalid-wilting-pricing", "Thao tác giá héo không hợp lệ.");
            if (action.GetString() == "save-rules")
            {
                var expected = Js.Get(body, "expectedRevision");
                var settings = WiltingPricing.Parse(body);
                if (settings is null || !Js.SafeInteger(expected) || Js.Number(expected) < 0)
                    throw new BackendException("invalid-wilting-pricing", "Quy tắc giá héo không hợp lệ hoặc có phạm vi trùng nhau.");
                var selectedIds = settings.Rules.SelectMany(rule => rule.ProductIds).Distinct(StringComparer.Ordinal).ToArray();
                if (selectedIds.Length > 500) throw new BackendException("invalid-wilting-pricing", "Mỗi cấu hình tối đa 500 sản phẩm khác nhau.");
                var saved = await db.RunTransactionAsync(async transaction =>
                {
                    var reference = db.Document(WiltingPriceStore.Document); var current = WiltingPriceStore.Read(await transaction.GetSnapshotAsync(reference, context.RequestAborted));
                    if (current.Revision != Js.Number(expected)) throw new BackendException("wilting-pricing-conflict", "Cấu hình đã được thay đổi ở nơi khác. Hãy tải lại trước khi lưu.");
                    if (selectedIds.Length > 0)
                    {
                        var products = await transaction.GetAllSnapshotsAsync(selectedIds.Select(id => db.Collection(Product.Collection).Document(id)), context.RequestAborted);
                        if (products.Any(doc => !doc.Exists)) throw new BackendException("invalid-wilting-pricing", "Một sản phẩm được chọn không còn tồn tại.");
                    }
                    var next = settings with { Revision = checked(current.Revision + 1) }; var data = WiltingPriceStore.SettingsData(next);
                    data["updatedAt"] = FieldValue.ServerTimestamp; data["updatedBy"] = owner.Uid;
                    transaction.SetJs(reference, data);
                    audit.AddAdminAudit(transaction, db, owner, "wilting.rules.updated", "metadata", "wiltingPricing",
                        new { before = WiltingPriceStore.SettingsData(current), after = WiltingPriceStore.SettingsData(next) });
                    return WiltingPriceStore.SettingsData(next);
                }, cancellationToken: context.RequestAborted);
                await context.Response.WriteAsJsonAsync(new { settings = saved }, context.RequestAborted); return;
            }
            var rawId = Js.Get(body, "productId"); var rawDate = Js.Get(body, "receivedDate"); var rawExpected = Js.Get(body, "expectedReceivedDate");
            if (!Js.IsString(rawId) || !WiltingPricing.ValidId(rawId.GetString()!) || !Js.IsString(rawDate) || !Js.IsString(rawExpected))
                throw new BackendException("invalid-wilting-pricing", "Sản phẩm hoặc ngày nhập không hợp lệ.");
            var id = rawId.GetString()!; var dateText = rawDate.GetString()!;
            if (dateText.Length > 0 && (!WiltingPricing.Date(dateText, out _) || string.CompareOrdinal(dateText, WiltingPricing.Today()) > 0))
                throw new BackendException("invalid-wilting-pricing", "Ngày nhập phải hợp lệ và không ở tương lai.");
            await db.RunTransactionAsync(async transaction =>
            {
                var product = await transaction.GetSnapshotAsync(db.Collection(Product.Collection).Document(id), context.RequestAborted);
                if (!product.Exists) throw new BackendException("product-not-found", "Không tìm thấy sản phẩm.");
                var reference = db.Collection(FirestoreCollections.ProductFreshness).Document(id); var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted);
                var previous = snapshot.Exists ? snapshot.ToDictionary().GetValueOrDefault("receivedDate") as string ?? "" : "";
                if (previous != rawExpected.GetString()) throw new BackendException("wilting-pricing-conflict", "Ngày nhập đã được thay đổi. Hãy tải lại trước khi lưu.");
                if (dateText.Length == 0) transaction.Delete(reference);
                else transaction.SetJs(reference, new Dictionary<string, object> { ["receivedDate"] = dateText, ["updatedAt"] = FieldValue.ServerTimestamp, ["updatedBy"] = owner.Uid });
                audit.AddAdminAudit(transaction, db, owner, "wilting.freshness.updated", "productFreshness", id,
                    new { before = previous, after = dateText });
                return 0;
            }, cancellationToken: context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new { productId = id, receivedDate = dateText }, context.RequestAborted);
        }
        catch (BackendException error)
        {
            var status = error.Code == "wilting-pricing-conflict" ? 409 : error.Code == "product-not-found" ? 404 : error.Code == "wilting-pricing-unavailable" ? 503 : 400;
            await ApiResponse.SendErrorAsync(context, status, error.Code, error.Message);
        }
        catch { logger.LogError("Wilting price operation failed."); await ApiResponse.SendErrorAsync(context, 503, "wilting-pricing-unavailable", "Chưa thể xử lý giá héo. Hãy thử lại."); }
    }
}
