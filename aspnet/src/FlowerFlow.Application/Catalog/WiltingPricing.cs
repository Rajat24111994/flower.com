using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;

namespace FlowerFlow.Application.Catalog;

public sealed record WiltingRule(string Id, string Name, bool Enabled, string Scope,
    IReadOnlyList<string> ProductIds, int StartAfterDays, int DailyDiscountPercent, long MinPrice);
public sealed record WiltingSettings(bool Enabled, IReadOnlyList<WiltingRule> Rules, long Revision = 0);
public sealed record WiltingPrice(long BasePrice, long Price, string RuleId, int AgeDays,
    int DiscountDays, string ReceivedDate, string PriceDate, long Revision)
{
    public Dictionary<string, object> Snapshot() => new()
    {
        ["basePrice"] = BasePrice, ["price"] = Price, ["ruleId"] = RuleId, ["ageDays"] = AgeDays,
        ["discountDays"] = DiscountDays, ["receivedDate"] = ReceivedDate, ["priceDate"] = PriceDate,
        ["revision"] = Revision, ["savingsPerUnit"] = BasePrice - Price
    };
}

// A bounded declarative formula, never an expression supplied for execution.
public static class WiltingPricing
{
    public static readonly WiltingSettings Disabled = new(false, []);
    public static bool ValidId(string value) => value.Length is > 0 and <= 128 && value.Trim() == value
        && !Regex.IsMatch(value, @"[/\x00-\x1f\x7f]");
    public static bool Date(string value, out DateOnly date) => DateOnly.TryParseExact(value, "yyyy-MM-dd",
        CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    public static string Today(DateTimeOffset? now = null) => OrderValidation.VietnameseDate(now);

    public static WiltingSettings? Parse(JsonElement input, long revision = 0)
    {
        var enabled = Js.Get(input, "enabled"); var values = Js.Get(input, "rules");
        if (enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 50) return null;
        var rules = new List<WiltingRule>(); var ids = new HashSet<string>(StringComparer.Ordinal);
        var targets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in values.EnumerateArray())
        {
            var id = Js.Get(row, "id"); var name = Js.Get(row, "name"); var scope = Js.Get(row, "scope");
            var active = Js.Get(row, "enabled"); var products = Js.Get(row, "productIds");
            var start = Js.Get(row, "startAfterDays"); var percent = Js.Get(row, "dailyDiscountPercent"); var floor = Js.Get(row, "minPrice");
            if (!Js.IsString(id) || !Regex.IsMatch(id.GetString()!, @"\A[A-Za-z0-9_-]{1,80}\z") || !ids.Add(id.GetString()!)
                || !Js.IsString(name) || name.GetString()!.Trim().Length is < 1 or > 80
                || !Js.IsString(scope) || scope.GetString() is not ("all" or "group" or "product")
                || active.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || products.ValueKind != JsonValueKind.Array || products.GetArrayLength() > 200
                || !Js.SafeInteger(start) || Js.Number(start) is < 0 or > 3650
                || !Js.SafeInteger(percent) || Js.Number(percent) is < 1 or > 100
                || !Js.SafeInteger(floor) || Js.Number(floor) is < 1000 or > 1_000_000_000) return null;
            var productIds = new List<string>();
            foreach (var product in products.EnumerateArray())
            {
                if (!Js.IsString(product) || !ValidId(product.GetString()!) || productIds.Contains(product.GetString()!, StringComparer.Ordinal)) return null;
                productIds.Add(product.GetString()!);
            }
            var kind = scope.GetString()!;
            if (kind == "all" && productIds.Count != 0 || kind == "product" && productIds.Count != 1 || kind == "group" && productIds.Count == 0) return null;
            // Same-priority overlaps are rejected; product > group > all is deterministic.
            if (active.GetBoolean())
                foreach (var target in kind == "all" ? ["all"] : productIds.Select(product => kind + ":" + product))
                    if (!targets.Add(target)) return null;
            rules.Add(new(id.GetString()!, name.GetString()!.Trim(), active.GetBoolean(), kind, productIds,
                (int)Js.Number(start), (int)Js.Number(percent), (long)Js.Number(floor)));
        }
        return new(enabled.GetBoolean(), rules, revision);
    }

    public static WiltingPrice? Calculate(string productId, double basePrice, string? receivedDate,
        WiltingSettings settings, DateTimeOffset? now = null)
    {
        if (!settings.Enabled || !Js.SafeInteger(basePrice) || basePrice <= 0
            || !Date(receivedDate ?? "", out var received)) return null;
        var todayText = Today(now); Date(todayText, out var today);
        var age = today.DayNumber - received.DayNumber;
        if (age < 0) return null;
        var rule = settings.Rules.Where(rule => rule.Enabled && (rule.Scope == "all" || rule.ProductIds.Contains(productId, StringComparer.Ordinal)))
            .OrderByDescending(rule => rule.Scope == "product" ? 2 : rule.Scope == "group" ? 1 : 0).FirstOrDefault();
        if (rule is null) return null;
        var days = Math.Max(0, age - rule.StartAfterDays + 1);
        var discount = Math.Min(100L, (long)days * rule.DailyDiscountPercent);
        var discounted = (long)Js.Round(basePrice * (100 - discount) / 100d);
        var price = Math.Min((long)basePrice, Math.Max(rule.MinPrice, discounted));
        return new((long)basePrice, price, rule.Id, age, days, receivedDate!, todayText, settings.Revision);
    }
}
