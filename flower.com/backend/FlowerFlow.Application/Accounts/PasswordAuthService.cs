using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace FlowerFlow.Application.Accounts;

/// <summary>Reason is a short, non-secret diagnostic for server logs; clients only ever see Code.</summary>
public sealed class AuthUnavailableException(string reason = "unavailable") : Exception("Password authentication is unavailable.")
{ public string Code => "auth-service-unavailable"; public string Reason { get; } = reason; }
public interface IPasswordAuthService
{
    Task AssertReadyAsync(CancellationToken cancellationToken = default);
    Task<PasswordAccount> LookupAsync(string email, CancellationToken cancellationToken = default);
    Task<bool> VerifyPasswordAsync(string email, string password, PasswordAccount account, CancellationToken cancellationToken = default);
}
public sealed record FrontendFirebaseConfig(string ApiKey)
{
    public static FrontendFirebaseConfig Load(string file)
    {
        var match = Regex.Match(File.ReadAllText(file), "apiKey\\s*:\\s*\"([^\"]+)\"");
        if (!match.Success) throw new AuthUnavailableException("frontend-config-missing-api-key");
        return new(match.Groups[1].Value);
    }
}

/// <summary>Port of accounts/password-auth.js, including both public-key bypass probes and server-side password-version lookup.</summary>
public sealed class PasswordAuthService : IPasswordAuthService
{
    private const string IdentityUrl = "https://identitytoolkit.googleapis.com/v1";
    private sealed record Config(string? Emulator, string? PublicKey, string ServerKey);
    private static readonly object CacheLock = new();
    private static string? _cachedKey;
    private static long _cachedUntil;
    private static Task? _cachedProbe;
    private readonly HttpClient _http;
    private readonly IFirebaseAccounts _accounts;
    private readonly string _frontendKey;
    private readonly bool _production;
    private readonly Func<string, string?> _environment;
    private readonly Func<long> _now;
    private readonly Config _config;

    [ActivatorUtilitiesConstructor]
    public PasswordAuthService(HttpClient http, IFirebaseAccounts accounts, FrontendFirebaseConfig frontend, IHostEnvironment environment)
        : this(http, accounts, frontend.ApiKey, environment.IsProduction()) { }
    public PasswordAuthService(HttpClient http, IFirebaseAccounts accounts, string frontendKey, bool production = false,
        Func<string, string?>? environment = null, Func<long>? clock = null)
    {
        _http = http; _accounts = accounts; _frontendKey = frontendKey; _production = production;
        _environment = environment ?? Environment.GetEnvironmentVariable;
        _now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); _config = Configuration();
    }
    private Config Configuration()
    {
        var emulator = _environment("FIREBASE_AUTH_EMULATOR_HOST"); if (string.IsNullOrEmpty(emulator)) emulator = null;
        if (emulator is not null && (_production || !string.IsNullOrEmpty(_environment("VERCEL")) || _environment("NODE_ENV") == "production")) throw new AuthUnavailableException("emulator-in-production");
        if (emulator is not null && !Regex.IsMatch(emulator, @"\A(localhost|127\.0\.0\.1):[0-9]+\z")) throw new AuthUnavailableException("emulator-host-invalid");
        var publicKey = _environment("FIREBASE_AUTH_PUBLIC_API_KEY"); var serverKey = _environment("FIREBASE_AUTH_SERVER_API_KEY");
        if (emulator is null && (string.IsNullOrEmpty(publicKey) || string.IsNullOrEmpty(serverKey) || serverKey == publicKey)) throw new AuthUnavailableException("auth-api-keys-missing-or-equal");
        return new(emulator, publicKey, emulator is null ? serverKey! : "emulator-key");
    }
    public async Task AssertReadyAsync(CancellationToken cancellationToken = default)
    {
        var config = Configuration(); if (config.Emulator is not null) return;
        if (config.PublicKey != _frontendKey) throw new AuthUnavailableException("public-key-mismatch");
        Task probe;
        lock (CacheLock)
        {
            if (_cachedKey == config.PublicKey && _cachedUntil > _now() && _cachedProbe is not null) probe = _cachedProbe;
            else
            {
                _cachedKey = config.PublicKey; _cachedUntil = _now() + 60_000;
                probe = _cachedProbe = ProbeAsync(config.PublicKey!, cancellationToken);
            }
        }
        try { await probe; }
        catch (Exception error) { lock (CacheLock) { _cachedProbe = null; _cachedKey = null; } throw new AuthUnavailableException(error is AuthUnavailableException known ? known.Reason : "public-key-probe-failed"); }
    }
    private async Task ProbeAsync(string publicKey, CancellationToken cancellationToken)
    {
        foreach (var endpoint in new[] { IdentityUrl + "/accounts:signInWithPassword", "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword" })
        {
            var (status, data) = await PostAsync(endpoint + "?key=" + Uri.EscapeDataString(publicKey),
                new { email = "login-policy-probe@invalid.example", password = Guid.NewGuid().ToString(), returnSecureToken = true }, null, cancellationToken);
            var details = Js.Get(Js.Get(data, "error"), "details");
            var blocked = status == HttpStatusCode.Forbidden && details.ValueKind == JsonValueKind.Array && details.EnumerateArray().Any(detail =>
                Js.Get(detail, "reason").ValueKind == JsonValueKind.String && Js.Get(detail, "reason").GetString() == "API_KEY_SERVICE_BLOCKED"
                // Google reports the blocked method as metadata.methodName; keep the older metadata.method.
                && new[] { "methodName", "method" }.Select(name => Js.StringOrEmpty(Js.Get(Js.Get(detail, "metadata"), name))).FirstOrDefault(value => value.Length > 0) is { } method
                && Regex.IsMatch(method, @"(?:SignInWithPassword|VerifyPassword|verifyPassword)$"));
            if (!blocked) throw new AuthUnavailableException($"public-key-not-blocked-http-{(int)status}");
        }
    }
    public async Task<PasswordAccount> LookupAsync(string email, CancellationToken cancellationToken = default)
    {
        var baseUrl = _config.Emulator is null ? IdentityUrl : $"http://{_config.Emulator}/identitytoolkit.googleapis.com/v1";
        var token = _config.Emulator is null ? await _accounts.GetAccessTokenAsync(cancellationToken) : "owner";
        var (status, data) = await PostAsync(baseUrl + "/projects/" + Uri.EscapeDataString(_accounts.ProjectId) + "/accounts:lookup",
            new { email = new[] { email } }, token, cancellationToken);
        var users = Js.Get(data, "users");
        if ((int)status is < 200 or >= 300 || Js.Truthy(users) && users.ValueKind != JsonValueKind.Array) throw new AuthUnavailableException($"account-lookup-http-{(int)status}");
        var user = users.ValueKind == JsonValueKind.Array && users.GetArrayLength() > 0 ? users[0] : default;
        if (Js.Truthy(user))
        {
            var uid = Js.Get(user, "localId"); var updated = Js.Get(user, "passwordUpdatedAt");
            var version = Js.Truthy(updated) ? Js.Number(updated) : 0;
            if (!Js.IsString(uid) || uid.GetString()!.Length == 0 || !double.IsFinite(version)) throw new AuthUnavailableException("account-lookup-invalid-user");
            return new(uid.GetString()!, uid.GetString(), version, Js.IsTrue(Js.Get(user, "disabled")));
        }
        // Same service-account source as the Admin SDK: inline JSON first, then the Render Secret File.
        string secret;
        try { secret = FirebaseServiceAccount.ReadJson(_environment); } catch { throw new AuthUnavailableException("service-account-unreadable"); }
        if (string.IsNullOrEmpty(secret)) throw new AuthUnavailableException("service-account-unreadable");
        return new("unknown-" + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(email))), null, 0);
    }
    public async Task<bool> VerifyPasswordAsync(string email, string password, PasswordAccount account, CancellationToken cancellationToken = default)
    {
        var baseUrl = _config.Emulator is null ? IdentityUrl : $"http://{_config.Emulator}/identitytoolkit.googleapis.com/v1";
        var (status, data) = await PostAsync(baseUrl + "/accounts:signInWithPassword?key=" + Uri.EscapeDataString(_config.ServerKey),
            new { email, password, returnSecureToken = true }, null, cancellationToken);
        if ((int)status is < 200 or >= 300)
        {
            var code = Js.StringOrEmpty(Js.Get(Js.Get(data, "error"), "message")).Split(" : ")[0];
            if (code is "INVALID_LOGIN_CREDENTIALS" or "INVALID_PASSWORD" or "EMAIL_NOT_FOUND") return false;
            // Provider codes such as API_KEY_SERVICE_BLOCKED are fixed identifiers, never user data.
            throw new AuthUnavailableException("password-check-" + (Regex.IsMatch(code, @"\A[A-Z_]{1,64}\z") ? code : $"http-{(int)status}"));
        }
        if (string.IsNullOrEmpty(account.Uid) || account.Disabled || !Js.IsString(Js.Get(data, "localId"))
            || Js.Get(data, "localId").GetString() != account.Uid || !Js.Truthy(Js.Get(data, "idToken"))) throw new AuthUnavailableException("password-check-account-mismatch");
        return true;
    }
    private async Task<(HttpStatusCode, JsonElement)> PostAsync(string url, object body, string? bearer, CancellationToken cancellationToken)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); timeout.CancelAfter(TimeSpan.FromSeconds(10));
            using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
            if (bearer is not null) request.Headers.Authorization = new("Bearer", bearer);
            using var response = await _http.SendAsync(request, timeout.Token);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            return (response.StatusCode, document.RootElement.Clone());
        }
        catch { throw new AuthUnavailableException("provider-request-failed"); }
    }
}
