using System.Globalization;
using System.Text.Json;
using Google.Cloud.Firestore;

namespace FlowerFlow.Application.Catalog;

public sealed record WiltingPriceContext(WiltingSettings Settings, IReadOnlyDictionary<string, string> ReceivedDates, DateTimeOffset Now)
{
    public WiltingPrice? Price(string id, Dictionary<string, object> product) => WiltingPricing.Calculate(id,
        PricingService.GetProductPrice(Js.Element(product)), ReceivedDates.GetValueOrDefault(id), Settings, Now);
    public void ApplyToLine(Dictionary<string, object> line, string id, Dictionary<string, object> product)
    {
        var price = Price(id, product);
        if (price is null) return;
        line["price"] = price.Price;
        line["wiltingPricing"] = price.Snapshot();
    }
}

public static class WiltingPriceStore
{
    public const string Document = "metadata/wiltingPricing";
    public static Dictionary<string, object> SettingsData(WiltingSettings settings) => new()
    {
        ["enabled"] = settings.Enabled, ["revision"] = settings.Revision,
        ["rules"] = settings.Rules.Select(rule => new Dictionary<string, object>
        {
            ["id"] = rule.Id, ["name"] = rule.Name, ["enabled"] = rule.Enabled, ["scope"] = rule.Scope,
            ["productIds"] = rule.ProductIds.ToArray(), ["startAfterDays"] = rule.StartAfterDays,
            ["dailyDiscountPercent"] = rule.DailyDiscountPercent, ["minPrice"] = rule.MinPrice
        }).ToList()
    };
    public static WiltingSettings Read(DocumentSnapshot document)
    {
        if (!document.Exists) return WiltingPricing.Disabled;
        var data = document.ToDictionary();
        var revision = data.GetValueOrDefault("revision") is long value && value >= 0 ? value : 0;
        return WiltingPricing.Parse(Js.Element(data), revision)
            ?? throw new BackendException("wilting-pricing-unavailable", "Cấu hình giá héo không hợp lệ. Vui lòng liên hệ chủ cửa hàng.");
    }
    public static async Task<WiltingPriceContext> LoadAsync(FirestoreDb db, IEnumerable<string> productIds,
        Transaction? transaction = null, CancellationToken cancellationToken = default, DateTimeOffset? now = null)
    {
        var reference = db.Document(Document);
        var config = transaction is null ? await reference.GetSnapshotAsync(cancellationToken)
            : await transaction.GetSnapshotAsync(reference, cancellationToken);
        var settings = Read(config); var dates = new Dictionary<string, string>(StringComparer.Ordinal);
        if (settings.Enabled)
        {
            var references = productIds.Distinct(StringComparer.Ordinal).Select(id => db.Collection(FirestoreCollections.ProductFreshness).Document(id)).ToArray();
            if (references.Length > 0)
            {
                var snapshots = transaction is null ? await db.GetAllSnapshotsAsync(references, cancellationToken)
                    : await transaction.GetAllSnapshotsAsync(references, cancellationToken);
                foreach (var snapshot in snapshots)
                    if (snapshot.Exists && snapshot.ToDictionary().GetValueOrDefault("receivedDate") is string date) dates[snapshot.Id] = date;
            }
        }
        return new(settings, dates, now ?? DateTimeOffset.UtcNow);
    }
}
