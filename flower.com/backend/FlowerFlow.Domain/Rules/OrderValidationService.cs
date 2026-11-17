using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FlowerFlow.Domain.Rules;

/// <summary>Port of backend/orders/validation.js.</summary>
public static class OrderValidationService
{
    public sealed record VietnameseDateTime(string Date, int Hour, int Minute);
    public static string NormalizePhone(JsonElement value) => Regex.Replace(Js.StringOrEmpty(value), "[^0-9]", "");
    public static string NormalizePhone(string value) => Regex.Replace(value, "[^0-9]", "");
    public static VietnameseDateTime GetVietnameseDateTime(DateTimeOffset? now = null)
    {
        var local = TimeZoneInfo.ConvertTime(now ?? DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(OrderConfig.DeliveryTimeZone));
        return new(local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), local.Hour, local.Minute);
    }
    public static string VietnameseDate(DateTimeOffset? now = null) => GetVietnameseDateTime(now).Date;
    public static bool IsValidPromotionDate(JsonElement value) => value.ValueKind == JsonValueKind.String && IsValidDate(value.GetString()!);
    public static bool IsValidDate(string value)
    {
        if (!Regex.IsMatch(value, @"\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z")) return false;
        var year = int.Parse(value[..4], CultureInfo.InvariantCulture); var month = int.Parse(value[5..7], CultureInfo.InvariantCulture);
        var day = int.Parse(value[8..], CultureInfo.InvariantCulture);
        return month is >= 1 and <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year == 0 ? 2000 : year, month);
    }
    public static string DeliveryScheduleError(string date, string time, DateTimeOffset? now = null)
    {
        if (!IsValidDate(date)) return "Ngày giao không hợp lệ.";
        if (!OrderConfig.DeliveryTimeWindows.Contains(time)) return "Vui lòng chọn khung giờ giao hợp lệ.";
        var local = GetVietnameseDateTime(now);
        if (string.CompareOrdinal(date, local.Date) < 0) return "Ngày giao không thể ở quá khứ.";
        if (date != local.Date) return "";
        if (local.Hour >= 15) return "Đã qua 15:00 tại Việt Nam. Vui lòng chọn ngày giao khác.";
        return int.Parse(time[..2], CultureInfo.InvariantCulture) <= local.Hour
            ? "Khung giờ giao đã bắt đầu. Vui lòng chọn khung giờ sau hoặc ngày khác." : "";
    }

    public static Dictionary<string, object>? ValidateCheckout(JsonElement body)
    {
        string Text(string key) => Js.StringOrEmpty(Js.Get(body, key)).Trim();
        var customerName = Text("customerName"); var phone = Text("phone"); var address = Text("address");
        var sameRecipient = Js.IsTrue(Js.Get(body, "customerIsRecipient"));
        var recipientName = sameRecipient ? customerName : Js.Truthy(Js.Get(body, "recipientName")) ? Text("recipientName") : customerName;
        var recipientPhone = sameRecipient ? phone : Js.Truthy(Js.Get(body, "recipientPhone")) ? Text("recipientPhone") : phone;
        var date = Text("deliveryDate"); var time = Text("deliveryTime"); var card = Text("greetingCard");
        var zone = Text("deliveryZoneId"); var wrap = Js.Truthy(Js.Get(body, "giftWrap")) ? Js.String(Js.Get(body, "giftWrap")) : "none";
        var payment = Js.StringOrEmpty(Js.Get(body, "paymentMethod")); var promotion = Text("promotionId"); var key = Text("idempotencyKey");
        var totals = Js.Get(body, "expectedTotals");
        if (customerName.Length is < 1 or > 100 || address.Length is < 1 or > 500
            || NormalizePhone(phone).Length is < 8 or > 15 || recipientName.Length > 120 || NormalizePhone(recipientPhone).Length is < 8 or > 15
            || !IsValidDate(date) || !OrderConfig.DeliveryTimeWindows.Contains(time) || !ValidZoneId(zone) || card.Length > 300
            || wrap is not ("none" or "pastel" or "classic") || payment is not ("qr" or "cod")
            || !Regex.IsMatch(key, @"\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z", RegexOptions.IgnoreCase)
            || promotion.Length > 100 || !Js.Truthy(totals)
            || !new[] { "subtotal", "savings", "tax", "shippingFee", "total" }.All(name => Js.SafeInteger(Js.Get(totals, name)) && Js.Number(Js.Get(totals, name)) >= 0)) return null;
        var wrapping = Js.Get(totals, "wrappingFee");
        if (wrapping.ValueKind != JsonValueKind.Undefined && (!Js.SafeInteger(wrapping) || Js.Number(wrapping) < 0)) return null;
        var items = NormalizeItems(Js.Get(body, "items")); if (items is null) return null;
        return new()
        {
            ["customerName"] = customerName, ["phone"] = phone, ["address"] = address, ["recipientName"] = recipientName,
            ["recipientPhone"] = recipientPhone, ["customerIsRecipient"] = sameRecipient, ["deliveryDate"] = date, ["deliveryTime"] = time,
            ["greetingCard"] = card, ["anonymousGreetingCard"] = Js.IsTrue(Js.Get(body, "anonymousGreetingCard")), ["deliveryZoneId"] = zone,
            ["giftWrap"] = wrap, ["paymentMethod"] = payment, ["promotionId"] = promotion, ["idempotencyKey"] = key,
            ["expectedTotals"] = totals.Clone(), ["items"] = items
        };
    }

    public static Dictionary<string, object>? ValidateQuote(JsonElement body)
    {
        var promotion = Js.StringOrEmpty(Js.Get(body, "promotionId")).Trim();
        var zone = Js.StringOrEmpty(Js.Get(body, "deliveryZoneId")).Trim();
        if (promotion.Length > 100 || zone.Length > 0 && !ValidZoneId(zone)) return null;
        var items = NormalizeItems(Js.Get(body, "items"));
        return items is null ? null : new() { ["items"] = items, ["promotionId"] = promotion, ["deliveryZoneId"] = zone };
    }

    private static List<Dictionary<string, object>>? NormalizeItems(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is < 1 or > 50) return null;
        var seen = new HashSet<string>(StringComparer.Ordinal); var items = new List<Dictionary<string, object>>();
        foreach (var item in value.EnumerateArray())
        {
            var rawId = Js.Get(item, "id");
            var id = rawId.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" : Js.String(rawId).Trim();
            var quantity = Js.Number(Js.Get(item, "quantity"));
            if (id.Length is < 1 or > 128 || id.Contains('/') || !seen.Add(id) || !Js.Integer(quantity)
                || quantity is < 1 or > OrderConfig.MaxQuantityPerProduct) return null;
            var options = BouquetOptions.Normalize(item); if (options is null) return null;
            var bouquetId = Js.StringOrEmpty(Js.Get(item, "customBouquetId"));
            if (bouquetId.Length > 0 && !ValidZoneId(bouquetId)) return null;
            var normalized = new Dictionary<string, object> { ["id"] = id, ["quantity"] = quantity };
            if (bouquetId.Length > 0) normalized["customBouquetId"] = bouquetId;
            foreach (var pair in options) normalized[pair.Key] = pair.Value;
            items.Add(normalized);
        }
        return items;
    }
    private static bool ValidZoneId(string id) => Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,80}\z");
}
