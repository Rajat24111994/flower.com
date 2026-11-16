using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Application.Abstractions;

/// <summary>Verifies the caller's Firebase ID token and, for staff APIs, the live admin/owner role.
/// On failure it writes the legacy error response and returns null.</summary>
public interface IFirebaseAuthService
{
    Task<FirebaseIdentity?> VerifyRequestAsync(HttpContext context);
    Task<FirebaseIdentity?> VerifyAdminRequestAsync(HttpContext context);
    Task<FirebaseIdentity?> VerifyOwnerRequestAsync(HttpContext context);
}
