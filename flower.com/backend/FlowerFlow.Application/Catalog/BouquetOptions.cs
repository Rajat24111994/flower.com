using System.Text.Json;

namespace FlowerFlow.Application.Catalog;

/// <summary>Server rules imported by orders/validation.js and checkout.js; browser source remains untouched.</summary>
public static class BouquetOptions
{
    public static Dictionary<string, object>? Normalize(JsonElement item)
    {
        if (new[] { "productId", "size", "color", "cardMessage", "personalNote" }.All(key => Js.Get(item, key).ValueKind == JsonValueKind.Undefined)) return new();
        var id = Js.Get(item, "productId");
        if (id.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) id = Js.Get(item, "id");
        var productId = id.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" : Js.String(id).Trim();
        var size = Js.Truthy(Js.Get(item, "size")) ? Js.String(Js.Get(item, "size")) : "standard";
        var color = Js.Truthy(Js.Get(item, "color")) ? Js.String(Js.Get(item, "color")) : "original";
        var card = Js.StringOrEmpty(Js.Get(item, "cardMessage")).Trim();
        var note = Js.StringOrEmpty(Js.Get(item, "personalNote")).Trim();
        if (productId.Length is < 1 or > 128 || productId.Contains('/') || size is not ("standard" or "large" or "premium")
            || color is not ("original" or "pink" or "white" or "red") || card.Length > 300 || note.Length > 500) return null;
        return new() { ["productId"] = productId, ["size"] = size, ["color"] = color, ["cardMessage"] = card, ["personalNote"] = note };
    }

    public static double Demand(IEnumerable<Dictionary<string, object>> items, string productId) => items
        .Where(item => Convert.ToString(item.GetValueOrDefault("productId") ?? item.GetValueOrDefault("id"), System.Globalization.CultureInfo.InvariantCulture) == productId)
        .Sum(item => Convert.ToDouble(item.GetValueOrDefault("quantity") ?? 1, System.Globalization.CultureInfo.InvariantCulture));
}
