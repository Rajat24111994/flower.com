namespace FlowerFlow.Domain.Models;

/// <summary>A verified Firebase user and the token claims the API relies on.</summary>
// Port of flower.com/backend/shared/firebase-admin.js only.
public sealed record FirebaseIdentity(string Uid, IReadOnlyDictionary<string, object> Claims);
