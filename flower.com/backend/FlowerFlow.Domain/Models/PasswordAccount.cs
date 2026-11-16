namespace FlowerFlow.Domain.Models;

/// <summary>Account key and password version used by the login lockout policy.</summary>
public sealed record PasswordAccount(string Key, string? Uid, double PasswordUpdatedAt, bool Disabled = false);
