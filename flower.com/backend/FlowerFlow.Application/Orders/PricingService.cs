using System.Globalization;
using System.Text.Json;

namespace FlowerFlow.Application.Orders;

/// <summary>Port of backend/orders/pricing.js. All amounts remain whole VND using JS rounding/order of operations.</summary>
public static class PricingService
{
    public static List<Dictionary<string, object>> GetEnabledDeliveryZones(JsonElement data)
    {
        var zones = Js.Get(data, "zones");
        return zones.ValueKind != JsonValueKind.Array ? [] : zones.EnumerateArray()
            .Where(zone => Js.IsTrue(Js.Get(zone, "enabled")) && Js.IsString(Js.Get(zone, "id"))
                && Js.IsString(Js.Get(zone, "province")) && Js.IsString(Js.Get(zone, "district"))
                && Js.SafeInteger(Js.Get(zone, "fee")) && Js.Number(Js.Get(zone, "fee")) >= 0)
            .Select(zone => (Dictionary<string, object>)Js.Object(zone)!).ToList();
    }
    public static (Dictionary<string, object>? Zone, double ShippingFee) ResolveDeliveryZone(JsonElement data, string? zoneId)
    {
        if (string.IsNullOrEmpty(zoneId)) return (null, 0);
        var zone = GetEnabledDeliveryZones(data).FirstOrDefault(zone => zone["id"] as string == zoneId);
        if (zone is null) throw new BackendException("delivery-zone-unavailable", "Khu vực giao hàng không còn khả dụng. Hãy chọn lại khu vực.");
        return (zone, Convert.ToDouble(zone["fee"], CultureInfo.InvariantCulture));
    }
    public static string GetProductSaleType(JsonElement data) => Js.Get(data, "saleType").ValueKind == JsonValueKind.String
        && Js.Get(data, "saleType").GetString() == "flower" ? "flower" : "ready_made";
    public static double ToVndPrice(JsonElement value)
    {
        var price = Js.Number(value);
        if (!double.IsFinite(price) || price < 0) return 0;
        return price is > 0 and < 1000 ? Js.Round(price * 25949.123093 / 1000) * 1000 : Js.Round(price);
    }
    public static double GetProductPrice(JsonElement data, DateTimeOffset? now = null) => ToVndPrice(Js.Get(data, "price"));
    public static List<Dictionary<string, object>> AggregateItems(JsonElement items)
    {
        var quantities = new Dictionary<string, double>(StringComparer.Ordinal);
        if (items.ValueKind == JsonValueKind.Array)
            foreach (var item in items.EnumerateArray())
            {
                var rawId = Js.Get(item, "productId");
                if (rawId.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) rawId = Js.Get(item, "id");
                var id = rawId.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" : Js.String(rawId);
                var number = Js.Number(Js.Get(item, "quantity"));
                var quantity = Math.Max(1, double.IsNaN(number) || number == 0 ? 1 : number);
                quantities[id] = quantities.GetValueOrDefault(id) + quantity;
            }
        return quantities.Select(pair => new Dictionary<string, object> { ["id"] = pair.Key, ["quantity"] = pair.Value }).ToList();
    }
    public static string PaymentReferenceFor(string idempotencyKey) => "FF" + Js.Cut(idempotencyKey.Replace("-", ""), 12).ToUpperInvariant();

    public static Dictionary<string, object>? FindPromotion(JsonElement promotions, string? promotionId, DateTimeOffset? now = null)
    {
        if (string.IsNullOrEmpty(promotionId)) return null;
        var promotion = promotions.ValueKind == JsonValueKind.Array ? promotions.EnumerateArray()
            .FirstOrDefault(item => Js.String(Js.Get(item, "id")) == promotionId && Js.IsTrue(Js.Get(item, "active"))) : default;
        if (promotion.ValueKind == JsonValueKind.Undefined)
            throw new BackendException("invalid-promotion", "Ưu đãi đã hết hạn hoặc không hợp lệ. Hãy tải lại trang thanh toán.");
        var percent = Js.Number(Js.Get(promotion, "discountPercent"));
        var start = Js.Get(promotion, "startDate"); var end = Js.Get(promotion, "endDate");
        var today = OrderValidationService.VietnameseDate(now);
        if (!double.IsFinite(percent) || percent is <= 0 or > 100
            || Js.Truthy(start) && !OrderValidationService.IsValidPromotionDate(start) || Js.Truthy(end) && !OrderValidationService.IsValidPromotionDate(end)
            || Js.Truthy(start) && Js.Truthy(end) && string.CompareOrdinal(Js.String(start), Js.String(end)) > 0
            || Js.Truthy(start) && string.CompareOrdinal(today, Js.String(start)) < 0
            || Js.Truthy(end) && string.CompareOrdinal(today, Js.String(end)) > 0)
            throw new BackendException("invalid-promotion", "Ưu đãi hiện không hợp lệ.");
        return (Dictionary<string, object>)Js.Object(promotion)!;
    }

    public static Dictionary<string, object> PriceCart(IReadOnlyList<Dictionary<string, object>> items, Dictionary<string, object>? promotion)
    {
        var data = Js.Element(promotion);
        var percent = promotion is null ? 0 : Js.Number(Js.Get(data, "discountPercent"));
        var ids = Js.Get(data, "productIds");
        var eligible = ids.ValueKind == JsonValueKind.Array ? ids.EnumerateArray().Select(Js.String).ToHashSet(StringComparer.Ordinal) : [];
        var all = Js.IsTrue(Js.Get(data, "allProducts")); double subtotal = 0, discount = 0;
        foreach (var item in items)
        {
            var price = Convert.ToDouble(item["price"], CultureInfo.InvariantCulture);
            var quantity = Convert.ToDouble(item["quantity"], CultureInfo.InvariantCulture);
            var id = item.GetValueOrDefault("productId") ?? item.GetValueOrDefault("id");
            subtotal += price * quantity;
            if (promotion is not null && (all || eligible.Contains(id is null ? "undefined" : Js.String(Js.Element(id)))))
                discount += price * quantity * percent / 100;
        }
        var savings = Math.Min(subtotal, Js.Round(discount));
        return new() { ["subtotal"] = subtotal, ["savings"] = savings, ["tax"] = 0, ["total"] = subtotal - savings };
    }

    public static List<Dictionary<string, object>> CalculateCustomBouquets(IReadOnlyList<Dictionary<string, object>> items, JsonElement tiers)
    {
        var groups = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            var flower = GetProductSaleType(Js.Element(item.GetValueOrDefault("data"))) == "flower";
            var id = item.GetValueOrDefault("customBouquetId") as string ?? "";
            if (flower != (id.Length > 0)) throw new BackendException("invalid-custom-bouquet",
                "Mỗi cành hoa phải thuộc một bó tùy chỉnh riêng; sản phẩm làm sẵn không thể ghép vào bó.");
            if (id.Length == 0) continue;
            groups[id] = groups.GetValueOrDefault(id) + Convert.ToDouble(item["quantity"], CultureInfo.InvariantCulture);
            if (groups[id] > BouquetWrapping.MaxStemsPerBouquet)
                throw new BackendException("bouquet-quantity-limit", $"Mỗi bó tùy chỉnh tối đa {BouquetWrapping.MaxStemsPerBouquet} cành.");
        }
        if (groups.Count > 0 && BouquetWrapping.NormalizeTiers(tiers) is null)
            throw new BackendException("bouquet-wrapping-unavailable", "Cửa hàng chưa cấu hình bậc phí bó hoa. Vui lòng liên hệ cửa hàng.");
        return groups.Select(pair => new Dictionary<string, object>
            { ["id"] = pair.Key, ["stemCount"] = pair.Value, ["wrappingFee"] = BouquetWrapping.FeeForStemCount(tiers, pair.Value)! }).ToList();
    }
}
