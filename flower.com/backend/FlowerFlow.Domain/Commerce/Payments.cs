namespace FlowerFlow.Domain.Commerce;

public sealed record PaymentAttempt(string Id, string OrderId, long Amount, string Status,
    string ProviderReference, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt = null, bool LatePayment = false) : IEntity;
public sealed record PaymentAudit(string Id, string OrderId, string Action, string ActorId, long Amount,
    string Reference, DateTimeOffset CreatedAt) : IEntity;
