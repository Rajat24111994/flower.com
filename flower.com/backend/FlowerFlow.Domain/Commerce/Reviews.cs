namespace FlowerFlow.Domain.Commerce;

public sealed record Review(string Id, string OrderId, string AuthorId, string CustomerName,
    IReadOnlyList<string> ProductIds, int Rating, string Comment, IReadOnlyList<string> Photos,
    string ModerationStatus, string ModerationReason, string Reply, DateTimeOffset CreatedAt,
    long Version = 1) : IEntity;
