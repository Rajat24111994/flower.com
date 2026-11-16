using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Domain.Rules;


namespace FlowerFlow.Commerce;

/// <summary>Port of backend/design-requests/validation.js.</summary>
internal static class DesignInputRules
{
    public static readonly string[] Statuses = ["Chờ tư vấn", "Chờ báo giá", "Chờ khách xác nhận", "Đang thực hiện", "Hoàn thành", "Đã hủy"];
    public static readonly string[] Colors = ["trắng", "đen", "kem", "hồng", "đỏ", "vàng", "cam", "xanh", "tím", "nhiều màu", "khác"];
    public static readonly IReadOnlyDictionary<string, int> TextLimits = new Dictionary<string, int>
    {
        ["arrangement"] = 40, ["size"] = 20, ["wrapStyle"] = 40, ["paperMaterial"] = 40, ["paperColor"] = 30,
        ["bowStyle"] = 30, ["bowColor"] = 30, ["theme"] = 40, ["style"] = 40, ["palette"] = 40,
        ["greetingCardTemplate"] = 40, ["greetingCard"] = 300, ["fragrance"] = 30, ["specialRequest"] = 1500,
        ["deliveryNote"] = 500, ["quoteNote"] = 1000
    };
    public static readonly IReadOnlyDictionary<string, string[]> DesignChoices = new Dictionary<string, string[]>
    {
        ["arrangement"] = ["Đối xứng", "Tự nhiên", "Hoa chính ở giữa", "Hoa xen kẽ"], ["size"] = ["Mini", "Nhỏ", "Vừa", "Lớn"],
        ["wrapStyle"] = ["Bó tròn", "Bó dài", "Bó một mặt", "Bó Hàn Quốc", "Bó tối giản", "Không gói"],
        ["paperMaterial"] = ["Giấy kraft", "Giấy nhám", "Giấy Hàn Quốc", "Giấy bóng kính"], ["bowStyle"] = ["Nơ nhỏ", "Nơ lớn", "Nơ lụa", "Không nơ"],
        ["theme"] = ["Sinh nhật", "Tình yêu", "Tốt nghiệp", "Khai trương", "Cảm ơn", "Kỷ niệm", "Ngày lễ", "Tự chọn"],
        ["style"] = ["Lãng mạn", "Sang trọng", "Dễ thương", "Tối giản", "Cổ điển", "Tự nhiên"],
        ["palette"] = ["Trắng - kem", "Hồng pastel", "Đỏ ấm", "Vàng tươi", "Xanh dịu", "Tím", "Nhiều màu"],
        ["greetingCardTemplate"] = ["Không cần thiệp", "Hoa lá", "Tối giản", "Chúc mừng", "Tình cảm"]
    };
    private static readonly CultureInfo Vietnamese = CultureInfo.GetCultureInfo("vi-VN");
    public static string? CleanText(JsonElement value, int maxLength)
    { var text = Js.StringOrEmpty(value).Trim(); return text.Length <= maxLength ? text : null; }
    public static string CanonicalColor(JsonElement value)
    {
        var key = Js.StringOrEmpty(value).Trim().ToLower(Vietnamese);
        return key switch { "white" => "trắng", "black" => "đen", "cream" => "kem", "pink" => "hồng", "red" => "đỏ",
            "yellow" => "vàng", "orange" => "cam", "green" or "blue" => "xanh", "purple" => "tím", "multicolor" => "nhiều màu", _ => key };
    }
    public static string? ValidImage(JsonElement value)
    {
        if (!Js.Truthy(value)) return "";
        if (!Js.IsString(value) || value.GetString()!.Length > 360000) return null;
        var text = value.GetString()!;
        var match = Regex.Match(text, @"\Adata:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})\z", RegexOptions.None, TimeSpan.FromSeconds(1));
        if (!match.Success) return null;
        byte[] bytes; try { bytes = Convert.FromBase64String(match.Groups[2].Value); } catch (FormatException) { return null; }
        if (Convert.ToBase64String(bytes) != match.Groups[2].Value || bytes.Length is < 12 or > 250000) return null;
        var valid = match.Groups[1].Value switch
        {
            "png" => bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "jpeg" => bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            _ => Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP"
        };
        return valid ? text : null;
    }

    public static Dictionary<string, object>? ParseDesign(JsonElement value = default)
    {
        if (value.ValueKind == JsonValueKind.Null) throw new InvalidOperationException("Design cannot be null.");
        var design = new Dictionary<string, object>();
        foreach (var (key, limit) in TextLimits)
        {
            var cleaned = CleanText(Js.Get(value, key), limit); if (cleaned is null) return null;
            if (cleaned.Length > 0) design[key] = cleaned;
        }
        var layers = Js.Get(value, "paperLayers"); var paperLayers = Js.Truthy(layers) ? Js.Number(layers) : 1;
        design["paperLayers"] = paperLayers;
        var mainId = Js.StringOrEmpty(Js.Get(value, "mainProductId")); design["mainProductId"] = mainId;
        if (mainId.Length > 128 || mainId.Contains('/')) return null;
        design["greenery"] = Js.IsTrue(Js.Get(value, "greenery"));
        var addons = Js.Get(value, "addons"); var normalizedAddons = new List<string>();
        if (addons.ValueKind == JsonValueKind.Array)
        {
            var sourceUnique = new HashSet<string>(StringComparer.Ordinal); var index = 0;
            foreach (var item in addons.EnumerateArray())
            {
                var text = Js.String(item);
                sourceUnique.Add(item.ValueKind is JsonValueKind.Object or JsonValueKind.Array ? "object:" + index++ : item.ValueKind + ":" + text);
                if (new[] { "gấu bông nhỏ", "hộp quà", "túi quà", "chocolate", "hoa baby phụ" }.Contains(text) && !normalizedAddons.Contains(text)) normalizedAddons.Add(text);
            }
            if (normalizedAddons.Count != sourceUnique.Count) return null;
        }
        design["addons"] = normalizedAddons;
        design["surprise"] = Js.IsTrue(Js.Get(value, "surprise")); design["confirmBeforeMaking"] = Js.Get(value, "confirmBeforeMaking").ValueKind != JsonValueKind.False;
        design["anonymousGreetingCard"] = Js.IsTrue(Js.Get(value, "anonymousGreetingCard")); design["lowFragrance"] = Js.IsTrue(Js.Get(value, "lowFragrance"));
        foreach (var name in new[] { "dislikedFlowers", "excludedFlowers" })
        {
            var input = Js.Get(value, name);
            design[name] = input.ValueKind == JsonValueKind.Array ? input.EnumerateArray().Select(item => Js.String(item).Trim())
                .Where(text => text.Length is > 0 and <= 60).Distinct(StringComparer.Ordinal).Take(10).ToList() : new List<string>();
        }
        var rawBudget = Js.Get(value, "budget");
        var budget = rawBudget.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null || rawBudget.ValueKind == JsonValueKind.String && rawBudget.GetString() == "" ? 0 : Js.Number(rawBudget);
        design["budget"] = budget;
        if (!Js.Integer(paperLayers) || paperLayers is < 0 or > 5 || !Js.SafeInteger(budget) || budget is < 0 or > 1_000_000_000
            || DesignChoices.Any(pair => design.TryGetValue(pair.Key, out var text) && !pair.Value.Contains((string)text))
            || new[] { "paperColor", "bowColor" }.Any(key => design.TryGetValue(key, out var text) && !Colors.Contains(((string)text).ToLower(Vietnamese)))) return null;
        return design;
    }

    public static List<Dictionary<string, object>>? NormalizeStems(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 20) return null;
        var seen = new HashSet<string>(StringComparer.Ordinal); var stems = new List<Dictionary<string, object>>(); double total = 0;
        foreach (var item in value.EnumerateArray())
        {
            var id = Js.StringOrEmpty(Js.Get(item, "productId")).Trim(); var quantity = Js.Number(Js.Get(item, "quantity"));
            var color = CleanText(Js.Get(item, "color"), 30); var rawRole = Js.Get(item, "role"); var role = Js.Truthy(rawRole) ? Js.String(rawRole) : "support";
            if (id.Length is < 1 or > 128 || id.Contains('/') || !seen.Add(id) || !Js.Integer(quantity) || quantity is < 1 or > 50
                || string.IsNullOrEmpty(color) || !Colors.Contains(color.ToLower(Vietnamese)) || role is not ("main" or "support")) return null;
            stems.Add(new() { ["productId"] = id, ["quantity"] = quantity, ["color"] = color, ["role"] = role }); total += quantity;
        }
        return total > BouquetWrapping.MaxStemsPerBouquet ? null : stems;
    }
}
