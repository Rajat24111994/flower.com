namespace FlowerFlow.Domain.Commerce;

// Records are immutable snapshots. Changes replace a record inside a unit of work.
public interface IEntity { string Id { get; } }
public sealed record Category(string Id, string Name) : IEntity;
public sealed record Product(string Id, string Title, string Description, string Image,
    IReadOnlyList<string> Images, string? CategoryId, long Price, long Quantity, string SaleType,
    string Status, string Meaning, IReadOnlyList<string> Colors, IReadOnlyList<string> Occasions,
    long Version = 1, long SoldCount = 0) : IEntity;
public sealed record PriceChange(string Id, string ProductId, long OldPrice, long NewPrice,
    string ActorId, DateTimeOffset CreatedAt) : IEntity;
public sealed record InventoryChange(string Id, string ProductId, long Delta, string Reason,
    string ActorId, DateTimeOffset CreatedAt) : IEntity;
public sealed record AuditEntry(string Id, string ActorId, string Action, string ResourceId,
    DateTimeOffset CreatedAt) : IEntity;
public sealed record ShopUser(string Id, string Role, bool Disabled = false) : IEntity;

public static class ProductRules
{
    public const long MaxSafeInteger = 9_007_199_254_740_991;
    public static bool SafeImage(string value) => !string.IsNullOrWhiteSpace(value)
        && Uri.TryCreate(new Uri("https://flowerflow.local"), value, out var uri)
        && uri.Scheme is "http" or "https";
    public static bool ValidId(string value) => !string.IsNullOrWhiteSpace(value)
        && value.Length <= 128 && !value.Contains('/') && !value.Any(char.IsControl);
}
