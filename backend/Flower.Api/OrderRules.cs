using System.Globalization;
using System.Text.RegularExpressions;
using static Flower.Api.Data;

namespace Flower.Api;

public static class OrderRules
{
    public static readonly string[] Windows = ["08:00–11:00", "11:00–14:00", "14:00–17:00", "17:00–20:00"];
    public static DateTime Vietnam(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(utc, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"));
    public static string Phone(string value) => Regex.Replace(value, @"\D", "");
    public static string Schedule(string date, string time, DateTime? now = null)
    {
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return "Ngày giao không hợp lệ.";
        if (!Windows.Contains(time)) return "Vui lòng chọn khung giờ giao hợp lệ.";
        var local = Vietnam(now ?? DateTime.UtcNow);
        var today = local.ToString("yyyy-MM-dd");
        if (string.CompareOrdinal(date, today) < 0) return "Ngày giao không thể ở quá khứ.";
        if (date != today) return "";
        if (local.Hour >= 15) return "Đã qua 15:00 tại Việt Nam. Vui lòng chọn ngày giao khác.";
        return int.Parse(time[..2]) <= local.Hour ? "Khung giờ giao đã bắt đầu. Vui lòng chọn khung giờ sau hoặc ngày khác." : "";
    }
    public static List<Dictionary<string, object>> EnabledZones(Dictionary<string, object> data) => Rows(data.Get("zones")).Where(z => z.B("enabled") && z.Get("id") is string && z.Get("province") is string && z.Get("district") is string && Safe(z.Get("fee")) && z.N("fee") >= 0).ToList();
    public static Dictionary<string, object>? Delivery(Dictionary<string, object> data, string id)
    {
        if (id.Length == 0) return null;
        return EnabledZones(data).FirstOrDefault(z => z.S("id") == id) ?? throw Error("delivery-zone-unavailable", "Khu vực giao hàng không còn khả dụng. Hãy chọn lại khu vực.");
    }
    public static List<Dictionary<string, object>> Bouquets(List<Dictionary<string, object>> cart, object? input)
    {
        var groups = new Dictionary<string, double>();
        foreach (var item in cart)
        {
            var id = item.S("customBouquetId");
            Require((Obj(item.Get("data")).S("saleType") == "flower") == (id.Length > 0), "invalid-custom-bouquet", "Mỗi cành hoa phải thuộc một bó tùy chỉnh riêng; sản phẩm làm sẵn không thể ghép vào bó.", 409);
            if (id.Length == 0) continue;
            groups[id] = groups.GetValueOrDefault(id) + item.N("quantity");
            Require(groups[id] <= 50, "bouquet-quantity-limit", "Mỗi bó tùy chỉnh tối đa 50 cành.", 409);
        }
        var tiers = CatalogEndpoints.Tiers(input);
        Require(groups.Count == 0 || tiers != null, "bouquet-wrapping-unavailable", "Cửa hàng chưa cấu hình bậc phí bó hoa. Vui lòng liên hệ cửa hàng.", 409);
        return groups.Select(pair => Map("id", pair.Key, "stemCount", pair.Value, "wrappingFee", tiers!.First(t => t.N("maxStems") >= pair.Value).N("fee"))).ToList();
    }
    public static string ProductId(Dictionary<string, object> item) => item.S("productId", item.S("id"));
    public static double Demand(IEnumerable<Dictionary<string, object>> items, string id) => items.Where(i => ProductId(i) == id).Sum(i => i.N("quantity"));
    public static List<Dictionary<string, object>> Aggregate(object? items) => Rows(items).GroupBy(ProductId).Select(g => Map("id", g.Key, "quantity", g.Sum(i => Math.Max(1, double.IsFinite(i.N("quantity")) && i.N("quantity") != 0 ? i.N("quantity") : 1)))).ToList();

    public static Dictionary<string, object>? Validate(Dictionary<string, object> body, bool checkout)
    {
        var promotionId = body.S("promotionId").Trim(); var zoneId = body.S("deliveryZoneId").Trim();
        var rows = Rows(body.Get("items"));
        if (promotionId.Length > 100 || (zoneId.Length > 0 && !Regex.IsMatch(zoneId, "^[A-Za-z0-9_-]{1,80}$")) || body.Get("items") is not System.Collections.IList || rows.Count is < 1 or > 50) return null;
        var items = new List<Dictionary<string, object>>(); var seen = new HashSet<string>();
        foreach (var item in rows)
        {
            var id = item.S("id").Trim(); var quantity = item.N("quantity");
            if (id.Length is < 1 or > 128 || id.Contains('/') || !seen.Add(id) || !Safe(quantity) || quantity is < 1 or > 50) return null;
            var result = Map("id", id, "quantity", quantity);
            var bouquetId = item.S("customBouquetId");
            if (bouquetId.Length > 0)
            {
                if (!Regex.IsMatch(bouquetId, "^[A-Za-z0-9_-]{1,80}$")) return null;
                result["customBouquetId"] = bouquetId;
            }
            if (new[] { "productId", "size", "color", "cardMessage", "personalNote" }.Any(item.ContainsKey))
            {
                var productId = ProductId(item).Trim(); var size = item.Or("size", "standard"); var color = item.Or("color", "original");
                var card = item.S("cardMessage").Trim(); var note = item.S("personalNote").Trim();
                if (productId.Length is < 1 or > 128 || productId.Contains('/') || !new[] { "standard", "large", "premium" }.Contains(size) || !new[] { "original", "pink", "white", "red" }.Contains(color) || card.Length > 300 || note.Length > 500) return null;
                result["productId"] = productId; result["size"] = size; result["color"] = color; result["cardMessage"] = card; result["personalNote"] = note;
            }
            items.Add(result);
        }
        if (!checkout) return Map("items", items, "promotionId", promotionId, "deliveryZoneId", zoneId);
        var customer = body.S("customerName").Trim(); var phone = body.S("phone").Trim(); var address = body.S("address").Trim();
        var recipient = body.B("customerIsRecipient") ? customer : body.Or("recipientName", customer).Trim();
        var recipientPhone = body.B("customerIsRecipient") ? phone : body.Or("recipientPhone", phone).Trim();
        var date = body.S("deliveryDate").Trim(); var time = body.S("deliveryTime").Trim(); var cardText = body.S("greetingCard").Trim();
        var gift = body.Or("giftWrap", "none"); var payment = body.S("paymentMethod"); var key = body.S("idempotencyKey").Trim(); var expected = Obj(body.Get("expectedTotals"));
        if (customer.Length is < 1 or > 100 || address.Length is < 1 or > 500 || Phone(phone).Length is < 8 or > 15 || recipient.Length > 120 || Phone(recipientPhone).Length is < 8 or > 15
            || !DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) || !Windows.Contains(time) || zoneId.Length == 0 || cardText.Length > 300
            || !new[] { "none", "pastel", "classic" }.Contains(gift) || !new[] { "qr", "cod", "vnpay" }.Contains(payment)
            || !Regex.IsMatch(key, "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase)
            || new[] { "subtotal", "savings", "tax", "shippingFee", "total" }.Any(k => !Safe(expected.Get(k)) || expected.N(k) < 0)
            || (expected.ContainsKey("wrappingFee") && (!Safe(expected.Get("wrappingFee")) || expected.N("wrappingFee") < 0))) return null;
        return Map("customerName", customer, "phone", phone, "address", address, "recipientName", recipient, "recipientPhone", recipientPhone, "customerIsRecipient", body.B("customerIsRecipient"), "deliveryDate", date, "deliveryTime", time, "greetingCard", cardText, "anonymousGreetingCard", body.B("anonymousGreetingCard"), "deliveryZoneId", zoneId, "giftWrap", gift, "paymentMethod", payment, "promotionId", promotionId, "idempotencyKey", key, "expectedTotals", expected, "items", items);
    }
    public static Dictionary<string, object>? Promotion(object? promotions, string id)
    {
        if (id.Length == 0) return null;
        var promotion = Rows(promotions).FirstOrDefault(p => p.S("id") == id && p.B("active"));
        Require(promotion != null, "invalid-promotion", "Ưu đãi đã hết hạn hoặc không hợp lệ. Hãy tải lại trang thanh toán.", 409);
        Require(double.IsFinite(promotion!.N("discountPercent")) && promotion.N("discountPercent") is > 0 and <= 100, "invalid-promotion", "Ưu đãi hiện không hợp lệ.", 409);
        return promotion;
    }
    public static Dictionary<string, object> Totals(List<Dictionary<string, object>> cart, Dictionary<string, object>? promotion, double wrappingFee, double shippingFee)
    {
        var subtotal = cart.Sum(i => i.N("price") * i.N("quantity"));
        var ids = Arr(promotion?.Get("productIds")).Select(Str).ToHashSet();
        var savings = Math.Min(subtotal, Round(cart.Sum(i => promotion != null && (promotion.B("allProducts") || ids.Contains(ProductId(i))) ? i.N("price") * i.N("quantity") * promotion.N("discountPercent") / 100 : 0)));
        return Map("subtotal", subtotal, "savings", savings, "tax", 0, "wrappingFee", wrappingFee, "shippingFee", shippingFee, "total", subtotal - savings + wrappingFee + shippingFee);
    }
    public static Dictionary<string, object> Line(Dictionary<string, object> item)
    {
        var data = Obj(item.Get("data")); var flower = data.S("saleType") == "flower";
        return Map("id", item.S("id"), "productId", ProductId(item), "title", Cut(data.S("title", "Sản phẩm"), 120), "image", Cut(data.S("image"), 1000), "saleType", flower ? "flower" : "ready_made", "unit", flower ? "cành" : "bó", "priceUpdatedAt", flower ? data.S("priceUpdatedAt") : "", "quantity", item.N("quantity"), "price", item.N("price"), "stock", item.N("stock"), "customBouquetId", item.S("customBouquetId"), "size", item.S("size"), "color", item.S("color"), "cardMessage", item.S("cardMessage"), "personalNote", item.S("personalNote"));
    }
}
