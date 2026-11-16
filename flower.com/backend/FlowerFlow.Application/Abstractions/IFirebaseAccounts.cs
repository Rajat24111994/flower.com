namespace FlowerFlow.Application.Abstractions;

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
