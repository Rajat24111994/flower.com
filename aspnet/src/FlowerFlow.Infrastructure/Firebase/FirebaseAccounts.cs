using System.Globalization;
using FirebaseAdmin.Auth;

namespace FlowerFlow.Infrastructure.Firebase;

public sealed record FirebaseAccount(string Uid, string? Email, string? DisplayName, bool Disabled,
    IReadOnlyDictionary<string, object> CustomClaims, IReadOnlyList<string> Providers, string CreationTime, string LastSignInTime)
{
    public string Role => CustomClaims.GetValueOrDefault("role") is "owner" ? "owner"
        : CustomClaims.GetValueOrDefault("admin") is true ? "admin" : "customer";
    public RoleUser ToRoleUser() => new(Uid, Email, CustomClaims);
}
public sealed record FirebaseUserPage(IReadOnlyList<FirebaseAccount> Users, string? NextPageToken);
public sealed class FirebaseAccountException(string code) : Exception("Firebase account operation failed.")
{ public string Code { get; } = code; }

public interface IFirebaseAccounts
{
    string ProjectId { get; }
    void EnsureConfigured();
    Task<string> GetAccessTokenAsync(CancellationToken cancellationToken);
    Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken);
    Task<FirebaseUserPage> ListUsersAsync(string? pageToken, CancellationToken cancellationToken);
    Task<FirebaseAccount> GetUserAsync(string uid, CancellationToken cancellationToken);
    Task SetCustomClaimsAsync(string uid, IDictionary<string, object> claims, CancellationToken cancellationToken);
    Task RevokeRefreshTokensAsync(string uid, CancellationToken cancellationToken);
}

/// <summary>Narrow SDK boundary for account operations; credentials never leave the server.</summary>
public sealed class FirebaseAccounts(FirebaseAdminBackend backend) : IFirebaseAccounts
{
    public string ProjectId => backend.ProjectId;
    public void EnsureConfigured() => backend.GetAdminAuth();
    public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken) => backend.GetAccessTokenAsync(cancellationToken);
    public Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken) => backend.GetAdminAuth().CreateCustomTokenAsync(uid, cancellationToken);
    public async Task<FirebaseUserPage> ListUsersAsync(string? pageToken, CancellationToken cancellationToken)
    {
        var pages = backend.GetAdminAuth().ListUsersAsync(new ListUsersOptions { PageSize = 100, PageToken = pageToken }).AsRawResponses();
        await using var iterator = pages.GetAsyncEnumerator(cancellationToken);
        if (!await iterator.MoveNextAsync()) return new([], null);
        return new(iterator.Current.Users.Select(Map).ToList(), iterator.Current.NextPageToken);
    }
    public async Task<FirebaseAccount> GetUserAsync(string uid, CancellationToken cancellationToken)
    {
        try { return Map(await backend.GetAdminAuth().GetUserAsync(uid, cancellationToken)); }
        catch (FirebaseAuthException error) when (error.AuthErrorCode == AuthErrorCode.UserNotFound)
        { throw new FirebaseAccountException("auth/user-not-found"); }
    }
    public Task SetCustomClaimsAsync(string uid, IDictionary<string, object> claims, CancellationToken cancellationToken) => backend.GetAdminAuth().SetCustomUserClaimsAsync(uid, new Dictionary<string, object>(claims), cancellationToken);
    public Task RevokeRefreshTokensAsync(string uid, CancellationToken cancellationToken) => backend.GetAdminAuth().RevokeRefreshTokensAsync(uid, cancellationToken);
    private static FirebaseAccount Map(UserRecord user) => new(user.Uid, user.Email, user.DisplayName, user.Disabled,
        user.CustomClaims, user.ProviderData.Select(provider => provider.ProviderId).ToList(),
        user.UserMetaData.CreationTimestamp?.ToUniversalTime().ToString("r", CultureInfo.InvariantCulture) ?? "",
        user.UserMetaData.LastSignInTimestamp?.ToUniversalTime().ToString("r", CultureInfo.InvariantCulture) ?? "");
}
