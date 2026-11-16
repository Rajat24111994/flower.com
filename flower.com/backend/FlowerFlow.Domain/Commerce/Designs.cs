namespace FlowerFlow.Domain.Commerce;

public sealed record DesignPreferences(string Arrangement = "", string Size = "", string WrapStyle = "",
    string PaperMaterial = "", string PaperColor = "", string BowStyle = "", string BowColor = "", string Theme = "",
    string Style = "", string Palette = "", string GreetingCardTemplate = "", string GreetingCard = "", string Fragrance = "",
    string SpecialRequest = "", string DeliveryNote = "", string QuoteNote = "", int PaperLayers = 1,
    string MainProductId = "", bool Greenery = false, IReadOnlyList<string>? Addons = null, bool Surprise = false,
    bool ConfirmBeforeMaking = true, bool AnonymousGreetingCard = false, bool LowFragrance = false,
    IReadOnlyList<string>? DislikedFlowers = null, IReadOnlyList<string>? ExcludedFlowers = null, long Budget = 0);
public sealed record DesignStem(string ProductId, int Quantity, string Color, string Role = "support");
public sealed record PricedStem(string ProductId, int Quantity, string Color, string Role, string Title, long Price);
public sealed record DesignHistory(string Status, string Detail, DateTimeOffset CreatedAt);
public sealed record FlowerDesign(string Id, string UserId, string AccessTokenHash, string CustomerName, string Phone,
    string Address, string DeliveryDate, string DeliveryTime, string DeliveryZoneId, string DeliveryNote,
    DesignPreferences Design, IReadOnlyList<PricedStem> Stems, string ReferenceImage, long Subtotal, long WrappingFee,
    long EstimatedTotal, long QuotedTotal, string QuoteNote, string Status, string CustomerResponse,
    IReadOnlyList<DesignHistory> History, DateTimeOffset CreatedAt, long Version = 1) : IEntity;
