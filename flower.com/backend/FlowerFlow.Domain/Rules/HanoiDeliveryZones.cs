using System.Text.Json;

namespace FlowerFlow.Domain.Rules;

/// <summary>
/// Default delivery areas used until an admin saves areas of their own: inner-city Hà Nội only,
/// priced from the shop in Hà Đông at a flat rate per kilometre. Distances are rounded road distances
/// from central Hà Đông to the centre of each district; alleys and villages are not added.
/// </summary>
public static class HanoiDeliveryZones
{
    public const string Province = "Hà Nội";
    public const string ShopDistrict = "Hà Đông";
    public const long FeePerKm = 5000;

    // Within Hà Đông itself the shop charges a short fixed distance instead of zero.
    private static readonly (string Id, string District, int Km)[] Districts =
    [
        ("hn-ha-dong", "Hà Đông", 3),
        ("hn-thanh-xuan", "Thanh Xuân", 6),
        ("hn-nam-tu-liem", "Nam Từ Liêm", 7),
        ("hn-cau-giay", "Cầu Giấy", 9),
        ("hn-dong-da", "Đống Đa", 9),
        ("hn-hoang-mai", "Hoàng Mai", 10),
        ("hn-hai-ba-trung", "Hai Bà Trưng", 11),
        ("hn-ba-dinh", "Ba Đình", 11),
        ("hn-hoan-kiem", "Hoàn Kiếm", 12),
        ("hn-bac-tu-liem", "Bắc Từ Liêm", 12),
        ("hn-tay-ho", "Tây Hồ", 14),
        ("hn-long-bien", "Long Biên", 17)
    ];

    public static List<Dictionary<string, object>> Zones() => Districts.Select(area => new Dictionary<string, object>
    {
        ["id"] = area.Id, ["province"] = Province, ["district"] = area.District,
        ["fee"] = area.Km * FeePerKm, ["enabled"] = true, ["distanceKm"] = area.Km
    }).ToList();

    /// <summary>True when the shop has saved its own list (even if every area is disabled).</summary>
    public static bool HasStoredZones(JsonElement data)
    {
        var zones = Js.Get(data, "zones");
        return zones.ValueKind == JsonValueKind.Array && zones.GetArrayLength() > 0;
    }

    /// <summary>The stored delivery document, or the default Hà Nội areas when nothing has been saved.</summary>
    public static JsonElement OrDefault(JsonElement data) =>
        HasStoredZones(data) ? data : JsonSerializer.SerializeToElement(new Dictionary<string, object> { ["zones"] = Zones() });
}
