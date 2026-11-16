namespace FlowerFlow.Domain.Constants;

/// <summary>Firestore collections that are not owned by a single entity in <c>Entities/</c>.</summary>
public static class FirestoreCollections
{
    public const string Metadata = "metadata";
    public const string Reviews = "reviews";
    public const string ProductFreshness = "productFreshness";
    public const string OrderPaymentAudit = "orderPaymentAudit";
    public const string ReviewImages = "reviewImages";
    public const string ProductImages = "productImages";
    public const string PriceHistory = "priceHistory";
    public const string OrderRequests = "orderRequests";
    public const string OrderLookupLimits = "orderLookupLimits";
    public const string OrderCreationLimits = "orderCreationLimits";
    public const string LoginProtection = "loginProtection";
}
