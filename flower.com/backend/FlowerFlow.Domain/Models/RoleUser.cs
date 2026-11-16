namespace FlowerFlow.Domain.Models;

/// <summary>The user fields needed to mirror admin claims into <c>adminRoles</c>.</summary>
public sealed record RoleUser(string Uid, string? Email, IReadOnlyDictionary<string, object>? CustomClaims);
