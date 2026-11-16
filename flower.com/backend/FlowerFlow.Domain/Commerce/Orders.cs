namespace FlowerFlow.Domain.Commerce;

public sealed record CustomerDetails(string Name, string Phone, string Address, string RecipientName,
    string RecipientPhone, bool CustomerIsRecipient, string DeliveryDate, string DeliveryTime,
    string GreetingCard, bool AnonymousGreetingCard, string GiftWrap, string OrderNote);
public sealed record TrackingEvent(string Status, string Location, string EstimatedDelivery, DateTimeOffset CreatedAt);
public sealed record Order(string Id, string UserId, CustomerDetails Customer, IReadOnlyList<PricedLine> Items,
    MoneyTotals Totals, DeliveryZone DeliveryZone, string PromotionId, string PaymentMethod, string PaymentReference,
    string Status, string InventoryState, DateTimeOffset? ReservationExpiresAt, bool PaymentVerified,
    string PaymentStatus, bool PaymentRefunded, IReadOnlyList<TrackingEvent> History, DateTimeOffset CreatedAt,
    long Version = 1, bool SalesCounted = false, bool ReservationExpired = false,
    string PaymentAttention = "", string CurrentPaymentId = "") : IEntity;
public sealed record OrderRequestKey(string Id, string UserId, string RequestHash, string OrderId) : IEntity;
public sealed record RequestLimit(string Id, int Count, DateTimeOffset ExpiresAt) : IEntity;

public static class OrderStatusRules
{
    private static readonly IReadOnlyDictionary<string, string[]> Next = new Dictionary<string, string[]>
    {
        ["Chờ xác nhận"] = ["Đang chuẩn bị", "Đã hủy"], ["Đang chuẩn bị"] = ["Đang giao", "Đã hủy"],
        ["Đang giao"] = ["Đã giao", "Đã hủy"], ["Đã giao"] = ["Đã hủy"], ["Đã hủy"] = ["Chờ xác nhận"]
    };
    public static bool CanTransition(string current, string next) => current == next || Next.TryGetValue(current, out var states) && states.Contains(next);
}
