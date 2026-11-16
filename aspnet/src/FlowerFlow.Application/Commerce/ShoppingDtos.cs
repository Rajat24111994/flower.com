using System.ComponentModel.DataAnnotations;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Application.Commerce;

public sealed record CartRequest([Required, MaxLength(50)] CartLine[] Items, [Range(0, long.MaxValue)] long ExpectedVersion);
public sealed record QuoteRequest([Required, MinLength(1), MaxLength(50)] CartLine[] Items,
    [StringLength(100)] string PromotionId = "", [StringLength(80)] string DeliveryZoneId = "");
public sealed record QuoteResponse(MoneyTotals Totals, IReadOnlyList<PricedLine> Items,
    IReadOnlyList<BouquetFee> CustomBouquets, DeliveryZoneResponse? DeliveryZone);
public sealed record PromotionRequest([Required, StringLength(120)] string Title,
    [Range(typeof(decimal), "0.0000000000000000000000000001", "100")] decimal DiscountPercent, bool AllProducts,
    [Required, MaxLength(100)] string[] ProductIds, bool Active, string StartDate = "", string EndDate = "");
public sealed record DeliveryZoneRequest([Required, StringLength(100)] string Province,
    [Required, StringLength(100)] string District, [Range(0, 1_000_000_000)] long Fee, bool Enabled = true);
public sealed record WrappingRequest([Required, MinLength(1), MaxLength(10)] WrappingTier[] Tiers);
