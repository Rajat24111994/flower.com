namespace FlowerFlow.Domain.Models;

/// <summary>Firebase Authentication user as returned to the admin APIs.</summary>
public sealed record FirebaseAccount(string Uid, string? Email, string? DisplayName, bool Disabled,
    IReadOnlyDictionary<string, object> CustomClaims, IReadOnlyList<string> Providers, string CreationTime, string LastSignInTime)
{
    public string Role => CustomClaims.GetValueOrDefault("role") is "owner" ? "owner"
        : CustomClaims.GetValueOrDefault("admin") is true ? "admin" : "customer";
    public RoleUser ToRoleUser() => new(Uid, Email, CustomClaims);
}
public sealed record FirebaseUserPage(IReadOnlyList<FirebaseAccount> Users, string? NextPageToken);
