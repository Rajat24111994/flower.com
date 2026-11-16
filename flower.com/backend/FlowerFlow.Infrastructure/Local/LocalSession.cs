using System.Globalization;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Infrastructure.Local;

/// <summary>Port of lib/local-session.js.</summary>
public static class LocalSession
{
    public const int SessionSeconds = 12 * 60 * 60;
    public const int SessionMs = SessionSeconds * 1000;
    public const string SessionCookieName = "flower_local_session";
    public static IReadOnlyList<string> SessionCookies(HttpContext context)
    {
        const string prefix = SessionCookieName + "=";
        return context.Request.Headers.Cookie.SelectMany(value => (value ?? "").Split(';')).Select(part => part.Trim())
            .Where(part => part.StartsWith(prefix, StringComparison.Ordinal)).Select(part => part[prefix.Length..]).ToArray();
    }
    public static string? SessionCookie(HttpContext context)
    { var cookies = SessionCookies(context); return cookies.Count > 1 ? "" : cookies.FirstOrDefault(); }
    public static void SetSessionCookie(HttpContext context, string token = "", DateTimeOffset? now = null)
    {
        var expires = token.Length > 0 ? (now ?? DateTimeOffset.UtcNow).AddMilliseconds(SessionMs) : DateTimeOffset.UnixEpoch;
        context.Response.Headers.SetCookie = $"{SessionCookieName}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={(token.Length > 0 ? SessionSeconds : 0)}; Expires={expires.UtcDateTime.ToString("r", CultureInfo.InvariantCulture)}{(context.Request.IsHttps ? "; Secure" : "")}";
    }
}
