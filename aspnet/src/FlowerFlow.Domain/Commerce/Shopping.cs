namespace FlowerFlow.Domain.Commerce;

public sealed record CartLine(string Id, int Quantity, string? ProductId = null, string Size = "standard",
    string Color = "original", string CardMessage = "", string PersonalNote = "", string CustomBouquetId = "");
public sealed record Cart(string Id, IReadOnlyList<CartLine> Items, long Version = 1) : IEntity;
public sealed record DeliveryZone(string Id, string Province, string District, long Fee, bool Enabled = true) : IEntity;
public sealed record WrappingTier(int MaxStems, long Fee);
public sealed record WrappingSettings(string Id, IReadOnlyList<WrappingTier> Tiers) : IEntity;
public sealed record Promotion(string Id, string Title, decimal DiscountPercent, bool AllProducts,
    IReadOnlyList<string> ProductIds, bool Active, string StartDate = "", string EndDate = "") : IEntity;
public sealed record MoneyTotals(long Subtotal, long Savings, long Tax, long WrappingFee, long ShippingFee, long Total);
public sealed record PricedLine(string Id, string ProductId, string Title, string Image, string SaleType,
    int Quantity, long Price, long Stock, string Size, string Color, string CardMessage, string PersonalNote, string CustomBouquetId);
public sealed record BouquetFee(string Id, int StemCount, long WrappingFee);
