using System.Text.Json;
using System.Text.Json.Serialization;

namespace FlowerFlow.Domain.Rules;

public sealed record BouquetTier([property: JsonPropertyName("maxStems")] int MaxStems,
    [property: JsonPropertyName("fee")] long Fee)
{
    public Dictionary<string, object> ToData() => new() { ["maxStems"] = MaxStems, ["fee"] = Fee };
}

/// <summary>Server copy of the pure rules imported from js/catalog/bouquet-wrapping.js; frontend stays unchanged.</summary>
public static class BouquetWrapping
{
    public const int MaxStemsPerBouquet = 50;
    public const int MaxTiers = 10;

    public static IReadOnlyList<BouquetTier>? NormalizeTiers(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is < 1 or > MaxTiers) return null;
        var previousMax = 0;
        var tiers = new List<BouquetTier>();
        foreach (var tier in value.EnumerateArray())
        {
            if (tier.ValueKind != JsonValueKind.Object || !tier.TryGetProperty("maxStems", out var max)
                || max.ValueKind != JsonValueKind.Number || !max.TryGetDouble(out var maxStems) || !double.IsFinite(maxStems)
                || maxStems != Math.Truncate(maxStems) || maxStems <= previousMax || maxStems > MaxStemsPerBouquet
                || !tier.TryGetProperty("fee", out var feeValue) || feeValue.ValueKind != JsonValueKind.Number
                || !feeValue.TryGetDouble(out var fee) || !double.IsFinite(fee) || fee != Math.Truncate(fee) || fee is < 0 or > 1_000_000_000)
                return null;
            previousMax = (int)maxStems;
            tiers.Add(new(previousMax, (long)fee));
        }
        return previousMax == MaxStemsPerBouquet ? tiers : null;
    }

    public static long? FeeForStemCount(JsonElement tiers, double stemCount)
    {
        var normalized = NormalizeTiers(tiers);
        if (normalized is null || !double.IsFinite(stemCount) || stemCount != Math.Truncate(stemCount)
            || stemCount is < 1 or > MaxStemsPerBouquet) return null;
        return normalized.First(tier => stemCount <= tier.MaxStems).Fee;
    }

    public static long? FeeForDesign(JsonElement tiers, double stemCount, JsonElement design = default)
    {
        if (!double.IsFinite(stemCount) || stemCount != Math.Truncate(stemCount) || stemCount is < 1 or > MaxStemsPerBouquet) return null;
        if (design.ValueKind == JsonValueKind.Object)
        {
            if (design.TryGetProperty("wrapStyle", out var style) && style.ValueKind == JsonValueKind.String && style.GetString() == "Không gói") return 0;
            if (design.TryGetProperty("paperLayers", out var layers))
            {
                var isZero = layers.ValueKind is JsonValueKind.Null or JsonValueKind.False
                    || (layers.ValueKind == JsonValueKind.Number && layers.GetDouble() == 0)
                    || (layers.ValueKind == JsonValueKind.String && (layers.GetString()!.Trim().Length == 0
                        || double.TryParse(layers.GetString(), System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture, out var number) && number == 0));
                if (isZero) return 0;
            }
        }
        return FeeForStemCount(tiers, stemCount);
    }
}
