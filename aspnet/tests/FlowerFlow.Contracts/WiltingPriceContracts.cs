using System.Text.Json;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;

static class WiltingPriceContracts
{
    public static void Run()
    {
        var count = 0;
        void Check(bool condition, string message) { AdditionalContracts.Require(condition, message); count++; }
        var now = DateTimeOffset.Parse("2026-11-16T05:00:00Z");
        var all = new WiltingRule("all", "Toàn bộ", true, "all", [], 1, 10, 30000);
        var settings = new WiltingSettings(true, [all], 3);
        WiltingPrice? Price(string date, DateTimeOffset? clock = null, WiltingSettings? config = null, string id = "rose", double price = 100000)
            => WiltingPricing.Calculate(id, price, date, config ?? settings, clock ?? now);
        Check(Price("2026-11-16")?.Price == 100000, "Arrival day must retain base price before threshold");
        Check(Price("2026-11-15")?.Price == 90000, "First discount day must subtract 10 percent of base");
        Check(Price("2026-11-14")?.Price == 80000, "Discount must be linear, not compounded");
        Check(Price("2026-11-01")?.Price == 30000, "Old stock must stop at floor");
        Check(Price("2026-11-15", price: 20000)?.Price == 20000, "A floor above base must never raise price");
        Check(Price("2026-11-15", price: 10005, config: settings with { Rules = [all with { MinPrice = 1000 }] })?.Price == 9005, "Whole VND rounding must match shop prices");
        Check(Price("2026-11-15", config: WiltingPricing.Disabled) == null, "Disabled settings must not change prices");
        Check(Price("") == null && Price("invalid") == null && Price("2026-02-29") == null, "Unknown dates must not invent age");
        Check(Price("2026-11-17") == null, "Future dates must not discount");
        Check(Price("2026-11-15", price: double.NaN) == null && Price("2026-11-15", price: 0) == null, "Invalid prices must not become a sale price");
        Check(Price("2026-11-15", DateTimeOffset.Parse("2026-11-16T16:59:59Z"))?.Price == 90000, "Vietnam day before midnight");
        Check(Price("2026-11-15", DateTimeOffset.Parse("2026-11-16T17:00:00Z"))?.Price == 80000, "Vietnam midnight must advance exactly one day");
        var group = all with { Id = "group", Scope = "group", ProductIds = ["rose", "lily"], DailyDiscountPercent = 20 };
        var product = all with { Id = "product", Scope = "product", ProductIds = ["rose"], DailyDiscountPercent = 30 };
        var priorities = settings with { Rules = [all, group, product] };
        Check(Price("2026-11-15", config: priorities)?.Price == 70000, "Product rule must win over group/all");
        Check(Price("2026-11-15", config: priorities, id: "lily")?.Price == 80000, "A group applies to an individual item");
        Check(Price("2026-11-15", config: priorities, id: "tulip")?.Price == 90000, "Unselected products must use global rule");
        Check(Price("2026-11-15", config: priorities with { Rules = [all, group, product with { Enabled = false }] })?.Price == 80000, "Disabled rules must not shadow enabled ones");
        Check(Price("2026-11-16", config: settings with { Rules = [all with { StartAfterDays = 0 }] })?.Price == 90000, "Zero means first discount on arrival day");
        Check(Price("2026-11-15", config: settings with { Rules = [all with { DailyDiscountPercent = 100 }] })?.Price == 30000, "100 percent must honor floor");
        Check(Price("2026-11-15")?.Snapshot()["revision"] is 3L, "Snapshot must record revision");
        var line = new Dictionary<string, object> { ["id"] = "rose", ["price"] = Price("2026-11-15")!.Price, ["quantity"] = 2 };
        var totals = OrderPricing.PriceCart([line], new Dictionary<string, object> { ["allProducts"] = true, ["discountPercent"] = 10 });
        Check(Convert.ToDouble(totals["subtotal"]) == 180000 && Convert.ToDouble(totals["total"]) == 162000, "Promotion must apply after wilting");
        object Rule(string scope = "all", string[]? ids = null, object? percent = null, int start = 1, long floor = 1000, string id = "r")
            => new { id, name = "Quy tắc", enabled = true, scope, productIds = ids ?? [], startAfterDays = start, dailyDiscountPercent = percent ?? 10, minPrice = floor };
        WiltingSettings? Parse(params object[] rules) => WiltingPricing.Parse(Js.Element(new { enabled = true, rules }));
        Check(Parse(Rule()) != null && Parse() != null, "Valid global and empty settings must parse");
        Check(Parse(Rule(percent: "10")) == null && Parse(Rule(percent: 0)) == null && Parse(Rule(percent: 101)) == null, "Reject coerced/out-of-range percent");
        Check(Parse(Rule(percent: 1.5)) == null && Parse(Rule(start: -1)) == null && Parse(Rule(floor: 999)) == null, "Reject invalid threshold/floor");
        Check(Parse(Rule("product")) == null && Parse(Rule("all", ["rose"])) == null && Parse(Rule("group")) == null, "Scopes must select correct counts");
        Check(Parse(Rule("group", ["rose", "rose"])) == null && Parse(Rule("product", ["../rose"])) == null, "Reject duplicates and document paths");
        Check(Parse(Rule(), Rule(id: "second")) == null, "Reject multiple active global rules");
        Check(Parse(Rule("group", ["rose"], id: "one"), Rule("group", ["rose", "lily"], id: "two")) == null, "Reject overlapping groups");
        Check(Parse(Rule("group", ["rose"], id: "one"), Rule("product", ["rose"], id: "two"), Rule(id: "all")) != null, "Different priorities must coexist");
        Check(WiltingPricing.Parse(JsonSerializer.SerializeToElement(new { enabled = "true", rules = Array.Empty<object>() })) == null, "Enabled must be boolean");
        Console.WriteLine($"PASS: {count} wilting formula, midnight, precedence, floor, validation and promotion checks.");
    }
}
