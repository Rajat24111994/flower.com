namespace FlowerFlow.Infrastructure.Firebase;

public interface IFirebaseAccounts
{
    string ProjectId { get; }
    void EnsureConfigured();
    Task<string> GetAccessTokenAsync(CancellationToken cancellationToken);
    Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken);
}

/// <summary>Narrow SDK boundary for account operations; credentials never leave the server.</summary>
public sealed class FirebaseAccounts(FirebaseAdminBackend backend) : IFirebaseAccounts
{
    public string ProjectId => backend.ProjectId;
    public void EnsureConfigured() => backend.GetAdminAuth();
    public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken) => backend.GetAccessTokenAsync(cancellationToken);
    public Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken) => backend.GetAdminAuth().CreateCustomTokenAsync(uid, cancellationToken);
}
