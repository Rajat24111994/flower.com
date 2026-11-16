using FlowerFlow.Domain.Entities;

namespace FlowerFlow.Application.Abstractions;

/// <summary>Firebase Admin SDK operations used to verify callers (implemented in Infrastructure).</summary>
public interface IFirebaseAdminService
{
    Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken);
    Task<AdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken);
}
