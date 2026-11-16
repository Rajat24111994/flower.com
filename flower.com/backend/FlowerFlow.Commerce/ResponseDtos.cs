using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

// HTTP contracts are explicit: adding a persistence field to an entity must not
// silently add that field to the public API. Stable value objects can be shared.
public sealed record CategoryResponse(string Id, string Name);
public sealed record CartResponse(string Id, IReadOnlyList<CartLine> Items, long Version);
public sealed record PriceChangeResponse(string Id, string ProductId, long OldPrice, long NewPrice,
    string ActorId, DateTimeOffset CreatedAt);
public sealed record InventoryChangeResponse(string Id, string ProductId, long Delta, string Reason,
    string ActorId, DateTimeOffset CreatedAt);
public sealed record OrderResponse(string Id, string UserId, CustomerDetails Customer,
    IReadOnlyList<PricedLine> Items, MoneyTotals Totals, DeliveryZoneResponse DeliveryZone, string PromotionId,
    string PaymentMethod, string PaymentReference, string Status, string InventoryState,
    DateTimeOffset? ReservationExpiresAt, bool PaymentVerified, string PaymentStatus, bool PaymentRefunded,
    IReadOnlyList<TrackingEvent> History, DateTimeOffset CreatedAt, long Version, bool SalesCounted,
    bool ReservationExpired, string PaymentAttention, string CurrentPaymentId);
public sealed record PaymentAttemptResponse(string Id, string OrderId, long Amount, string Status,
    string ProviderReference, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, bool LatePayment);
public sealed record PaymentAuditResponse(string Id, string OrderId, string Action, string ActorId,
    long Amount, string Reference, DateTimeOffset CreatedAt);
public sealed record UserResponse(string Id, string Role, bool Disabled);
public sealed record AuditEntryResponse(string Id, string ActorId, string Action, string ResourceId, DateTimeOffset CreatedAt);
public sealed record DeliveryZoneResponse(string Id, string Province, string District, long Fee, bool Enabled);
public sealed record PromotionResponse(string Id, string Title, decimal DiscountPercent, bool AllProducts,
    IReadOnlyList<string> ProductIds, bool Active, string StartDate, string EndDate);
public sealed record WrappingResponse(string Id, IReadOnlyList<WrappingTier> Tiers);

public static class ResponseMapping
{
    public static CategoryResponse ToResponse(this Category item) => new(item.Id, item.Name);
    public static CartResponse ToResponse(this Cart item) => new(item.Id, item.Items.ToArray(), item.Version);
    public static PriceChangeResponse ToResponse(this PriceChange item) => new(item.Id, item.ProductId,
        item.OldPrice, item.NewPrice, item.ActorId, item.CreatedAt);
    public static InventoryChangeResponse ToResponse(this InventoryChange item) => new(item.Id, item.ProductId,
        item.Delta, item.Reason, item.ActorId, item.CreatedAt);
    public static OrderResponse ToResponse(this Order item) => new(item.Id, item.UserId, item.Customer,
        item.Items.ToArray(), item.Totals, item.DeliveryZone.ToResponse(), item.PromotionId, item.PaymentMethod,
        item.PaymentReference, item.Status, item.InventoryState, item.ReservationExpiresAt, item.PaymentVerified,
        item.PaymentStatus, item.PaymentRefunded, item.History.ToArray(), item.CreatedAt, item.Version,
        item.SalesCounted, item.ReservationExpired, item.PaymentAttention, item.CurrentPaymentId);
    public static PaymentAttemptResponse ToResponse(this PaymentAttempt item) => new(item.Id, item.OrderId,
        item.Amount, item.Status, item.ProviderReference, item.CreatedAt, item.ExpiresAt, item.LatePayment);
    public static PaymentAuditResponse ToResponse(this PaymentAudit item) => new(item.Id, item.OrderId,
        item.Action, item.ActorId, item.Amount, item.Reference, item.CreatedAt);
    public static UserResponse ToResponse(this ShopUser item) => new(item.Id, item.Role, item.Disabled);
    public static AuditEntryResponse ToResponse(this AuditEntry item) => new(item.Id, item.ActorId,
        item.Action, item.ResourceId, item.CreatedAt);
    public static DeliveryZoneResponse ToResponse(this DeliveryZone item) => new(item.Id, item.Province, item.District, item.Fee, item.Enabled);
    public static PromotionResponse ToResponse(this Promotion item) => new(item.Id, item.Title, item.DiscountPercent,
        item.AllProducts, item.ProductIds.ToArray(), item.Active, item.StartDate, item.EndDate);
    public static WrappingResponse ToResponse(this WrappingSettings item) => new(item.Id, item.Tiers.ToArray());
}
