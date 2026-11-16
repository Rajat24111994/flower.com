using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Infrastructure.Security;

/// <summary>Port of shared/request-identity.js, including the server-only local identity boundary.</summary>
public sealed class RequestIdentityService(IFirebaseAdminService backend) : IRequestIdentityService
{
    // Called by trusted local-server middleware only. The key cannot be supplied by HTTP input.
    public static void SetLocalIdentity(HttpContext context, FirebaseIdentity? account, bool presented) =>
        LocalIdentityContext.SetLocalIdentity(context, account, presented);

    public static bool HasLocalIdentity(HttpContext context) => LocalIdentityContext.HasLocalIdentity(context);

    public static string? SessionCookie(HttpContext context) => LocalSession.SessionCookie(context);

    public async Task<FirebaseIdentity?> OptionalCustomerAsync(HttpContext context)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (LocalIdentityContext.TryGet(context, out var local))
        {
            if (local.Account is null && local.Presented)
                throw new RequestIdentityException("auth/invalid-session", "Invalid local session");
            if (authorization.Length > 0)
                throw new RequestIdentityException("auth/invalid-session", "Unexpected bearer token in local mode");
            return local.Account;
        }
        if (authorization.Length == 0) return null;
        var token = BearerToken.Read(authorization, singleToken: true);
        if (token is null) throw new RequestIdentityException("auth/invalid-session", "Invalid authorization");
        try { return await backend.VerifyIdTokenAsync(token, true, context.RequestAborted); }
        catch (FirebaseAuthException error)
        {
            throw new RequestIdentityException("auth/" + error.AuthErrorCode, "Invalid Firebase session");
        }
    }
}
