using System.ComponentModel.DataAnnotations;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed record CheckoutRequest(
    [Required, MinLength(1), MaxLength(50)] CartLine[] Items,
    [Required, StringLength(100)] string CustomerName,
    [Required, StringLength(30)] string Phone,
    [Required, StringLength(500)] string Address,
    [Required] string DeliveryDate, [Required] string DeliveryTime, [Required] string DeliveryZoneId,
    [Required, RegularExpression("^(cod|qr)$")] string PaymentMethod,
    [Required] string IdempotencyKey, [Required] MoneyTotals ExpectedTotals,
    string RecipientName = "", string RecipientPhone = "", bool CustomerIsRecipient = true,
    [StringLength(300)] string GreetingCard = "", bool AnonymousGreetingCard = false,
    string GiftWrap = "none", [StringLength(100)] string PromotionId = "", [StringLength(500)] string OrderNote = "");
public sealed record CreatedOrder(string Id, string PaymentReference, MoneyTotals Totals);
public sealed record OrderStatusRequest([Required] string Status, [Range(1, long.MaxValue)] long ExpectedVersion,
    [StringLength(500)] string Location = "", [StringLength(100)] string EstimatedDelivery = "", bool RestockSold = false);
public sealed record TrackOrderRequest([Required, StringLength(128)] string OrderId, [Required, StringLength(30)] string Phone);
public sealed record TrackingResponse(string Id, string Status, IReadOnlyList<TrackingEvent> History,
    string PaymentMethod, string PaymentStatus, long? Total, string? PaymentReference, DateTimeOffset? ReservationExpiresAt);
