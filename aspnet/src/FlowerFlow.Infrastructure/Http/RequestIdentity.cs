using FirebaseAdmin.Auth;
using FlowerFlow.Infrastructure.Firebase;
using Microsoft.AspNetCore.Http;
using FlowerFlow.Infrastructure.Local;

namespace FlowerFlow.Infrastructure.Http;

public sealed class RequestIdentityException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Port of shared/request-identity.js, including the server-only local identity boundary.</summary>
public sealed class RequestIdentity(IFirebaseAdminBackend backend)
{
    private static readonly object LocalIdentityKey = new();
    private sealed record LocalIdentity(FirebaseIdentity? Account, bool Presented);

    // Called by trusted local-server middleware only. The key cannot be supplied by HTTP input.
    public static void SetLocalIdentity(HttpContext context, FirebaseIdentity? account, bool presented) =>
        context.Items[LocalIdentityKey] = new LocalIdentity(account, presented);

    public static bool HasLocalIdentity(HttpContext context) => context.Items.ContainsKey(LocalIdentityKey);

    public static string? SessionCookie(HttpContext context) => LocalSession.SessionCookie(context);

    public async Task<FirebaseIdentity?> OptionalCustomerAsync(HttpContext context)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (context.Items.TryGetValue(LocalIdentityKey, out var value) && value is LocalIdentity local)
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
