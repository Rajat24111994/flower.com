using System.Security.Claims;
using System.Text.Encodings.Web;
using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace FlowerFlow.Backend.Configurations;

public sealed class DevelopmentAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger, UrlEncoder encoder, ICommerceUnitOfWork work)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "DevelopmentUser";
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Development-User", out var values)) return AuthenticateResult.NoResult();
        if (values.Count != 1) return AuthenticateResult.Fail("Invalid development identity.");
        var user = await work.ExecuteAsync((session, ct) => session.Repository<ShopUser>().FindAsync(values[0]!, ct), Context.RequestAborted);
        if (user is null || user.Disabled) return AuthenticateResult.Fail("Unknown or disabled development identity.");
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Role, user.Role)], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }
}

public sealed class HttpCurrentActor(IHttpContextAccessor accessor) : ICurrentActor
{
    public string UserId => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
    public string Role => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.Role) ?? "";
    public string ClientKey => accessor.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "testserver";
}
