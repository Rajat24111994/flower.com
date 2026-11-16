using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Api.Middleware;

/// <summary>
/// Development-only local accounts: attaches the session-cookie identity to API requests so
/// services resolve the customer through <see cref="IRequestIdentityService"/>. Runs after
/// <see cref="BackendServer"/>, which forwards only validated <c>/api/...</c> requests (and <c>/health</c>).
/// </summary>
public sealed class RequestIdentityMiddleware(RequestDelegate next, ILocalAccountWorker? accounts)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (accounts is not null && context.Request.Path.StartsWithSegments("/api") && context.Request.Path != "/api/login")
        {
            var token = LocalSession.SessionCookie(context);
            var account = token is { Length: > 0 } ? await accounts.SessionAsync(token) : null;
            LocalIdentityContext.SetLocalIdentity(context, account is null ? null : new FirebaseIdentity((string)account["uid"], account), token is not null);
        }
        await next(context);
    }
}
