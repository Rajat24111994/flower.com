namespace FlowerFlow.Application.Orders;

/// <summary>
/// Exact business constants from flower.com/backend/orders/config.js.
/// Durations remain in milliseconds to preserve the legacy timestamp arithmetic.
/// </summary>
public static class OrderConfig
{
    public const int MaxQuantityPerProduct = 50;

    public const int QrReservationMs = 30 * 60 * 1000;
    public const int VnpayReservationMs = 15 * 60 * 1000;
    public const int CodReservationMs = 30 * 60 * 1000;

    public const int OrderLookupWindowMs = 10 * 60 * 1000;
    public const int OrderLookupMaxAttempts = 20;

    public static IReadOnlyList<string> DeliveryTimeWindows { get; } = Array.AsReadOnly(
        new[] { "08:00–11:00", "11:00–14:00", "14:00–17:00", "17:00–20:00" });

    public const string DeliveryTimeZone = "Asia/Ho_Chi_Minh";
    public const int MaxOrderNoteLength = 500;
}
