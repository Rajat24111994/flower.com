using System.Text.Json;

// Default delivery areas: inner-city Hà Nội only, 5,000 VND per km from the shop in Hà Đông.
static class HanoiDeliveryContracts
{
    public static void Run()
    {
        var count = 0;
        void Check(bool condition, string message) { AdditionalContracts.Require(condition, message); count++; }
        JsonElement Doc(object value) => JsonSerializer.SerializeToElement(value);
        var empty = Doc(new { });
        var zones = HanoiDeliveryZones.Zones();

        Check(zones.Count == 12 && zones.All(zone => (string)zone["province"] == "Hà Nội" && (bool)zone["enabled"]),
            "Defaults must cover the 12 inner-city Hà Nội districts only");
        Check(zones.All(zone => (long)zone["fee"] == (int)zone["distanceKm"] * 5000), "Every default fee must be 5,000 VND per km");
        var namTuLiem = zones.Single(zone => (string)zone["district"] == "Nam Từ Liêm");
        Check((int)namTuLiem["distanceKm"] == 7 && (long)namTuLiem["fee"] == 35000, "Hà Đông → Nam Từ Liêm must be 7 km = 35,000 VND");
        Check((long)zones.Single(zone => (string)zone["district"] == "Hà Đông")["fee"] == 15000, "Delivery inside Hà Đông must cost the short fixed distance");

        var (zone, fee) = PricingService.ResolveDeliveryZone(HanoiDeliveryZones.OrDefault(empty), "hn-nam-tu-liem");
        Check(zone is not null && fee == 35000, "Checkout must price a default area when nothing is saved");
        Check(PricingService.GetEnabledDeliveryZones(HanoiDeliveryZones.OrDefault(Doc(new { zones = Array.Empty<object>() }))).Count == 12,
            "An empty saved list must still offer the defaults");
        try { PricingService.ResolveDeliveryZone(HanoiDeliveryZones.OrDefault(empty), "hcm-quan-1"); Check(false, "Areas outside Hà Nội must be rejected"); }
        catch (BackendException error) { Check(error.Code == "delivery-zone-unavailable", "Unknown areas must use the existing unavailable error"); }

        var saved = Doc(new { zones = new[] { new { id = "shop-zone", province = "Hà Nội", district = "Ba Đình", fee = 25000, enabled = true } } });
        Check(PricingService.ResolveDeliveryZone(HanoiDeliveryZones.OrDefault(saved), "shop-zone").ShippingFee == 25000,
            "Areas saved by the shop must keep their own fee");
        try { PricingService.ResolveDeliveryZone(HanoiDeliveryZones.OrDefault(saved), "hn-nam-tu-liem"); Check(false, "Defaults must not mix into a saved list"); }
        catch (BackendException) { count++; }
        var paused = Doc(new { zones = new[] { new { id = "off", province = "Hà Nội", district = "Ba Đình", fee = 0, enabled = false } } });
        Check(PricingService.GetEnabledDeliveryZones(HanoiDeliveryZones.OrDefault(paused)).Count == 0,
            "A shop that disabled every saved area must not get the defaults back");

        Console.WriteLine($"PASS: {count} Hà Nội default delivery checks (Hà Đông origin, 5,000 VND/km, saved areas take priority).");
    }
}
