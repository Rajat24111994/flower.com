using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FlowerFlow.Infrastructure.Accounts;
using FlowerFlow.Infrastructure.Firebase;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

static class PasswordContracts
{
    public static async Task RunAsync()
    {
        var key = "public-" + Guid.NewGuid().ToString("N"); var serverKey = "server-test-key";
        var env = new Dictionary<string, string?> { ["FIREBASE_AUTH_PUBLIC_API_KEY"] = key,
            ["FIREBASE_AUTH_SERVER_API_KEY"] = serverKey, ["FIREBASE_SERVICE_ACCOUNT_JSON"] = "test-hmac-secret" };
        var accounts = new TestFirebaseAccounts();
        var probes = 0; var lookupJson = "{\"users\":[{\"localId\":\"known-user\",\"passwordUpdatedAt\":\"123\"}]}";
        var verifyStatus = HttpStatusCode.OK; var verifyJson = "{\"localId\":\"known-user\",\"idToken\":\"upstream-token-never-returned\"}";
        using var http = new HttpClient(new StubHttpHandler(async request =>
        {
            AdditionalContracts.Require(request.Method == HttpMethod.Post, "Password provider changed HTTP method");
            if (request.RequestUri!.Query.Contains(key))
            {
                probes++;
                return Response(HttpStatusCode.Forbidden, "{\"error\":{\"details\":[{\"reason\":\"API_KEY_SERVICE_BLOCKED\",\"metadata\":{\"method\":\"google.identitytoolkit.v1.AuthenticationService.SignInWithPassword\"}}]}}");
            }
            if (request.RequestUri.AbsolutePath.EndsWith("accounts:lookup"))
            {
                AdditionalContracts.Require(request.Headers.Authorization?.ToString() == "Bearer access-token", "Lookup not authorized with server OAuth token");
                var payload = await request.Content!.ReadFromJsonAsync<JsonElement>();
                AdditionalContracts.Require(payload.GetProperty("email")[0].GetString() == "user@example.invalid", "Lookup email shape changed");
                return Response(HttpStatusCode.OK, lookupJson);
            }
            AdditionalContracts.Require(request.RequestUri.Query.Contains(serverKey), "Password check used public API key");
            return Response(verifyStatus, verifyJson);
        }));
        long now = 1000;
        var provider = new PasswordAuth(http, accounts, key, false, name => env.GetValueOrDefault(name), () => now);
        await Task.WhenAll(provider.AssertReadyAsync(), provider.AssertReadyAsync());
        await provider.AssertReadyAsync(); AdditionalContracts.Require(probes == 2, "Probe cache did not cover both endpoints exactly once");
        now += 60_000; await provider.AssertReadyAsync(); AdditionalContracts.Require(probes == 4, "Public key probe cache did not expire");
        var known = await provider.LookupAsync("user@example.invalid");
        AdditionalContracts.Require(known.Key == "known-user" && known.PasswordUpdatedAt == 123, "Server password version lookup changed");
        AdditionalContracts.Require(await provider.VerifyPasswordAsync("user@example.invalid", "password", known), "Valid provider password rejected");
        verifyStatus = HttpStatusCode.BadRequest; verifyJson = "{\"error\":{\"message\":\"INVALID_PASSWORD\"}}";
        AdditionalContracts.Require(!await provider.VerifyPasswordAsync("user@example.invalid", "password", known), "Wrong password not recognized");
        verifyJson = "{\"error\":{\"message\":\"TOO_MANY_ATTEMPTS_TRY_LATER\"}}";
        await Unavailable(() => provider.VerifyPasswordAsync("user@example.invalid", "password", known));
        verifyStatus = HttpStatusCode.OK; verifyJson = "{\"localId\":\"another-user\",\"idToken\":\"token\"}";
        await Unavailable(() => provider.VerifyPasswordAsync("user@example.invalid", "password", known));
        verifyJson = "{\"localId\":\"known-user\",\"idToken\":\"token\"}";
        await Unavailable(() => provider.VerifyPasswordAsync("user@example.invalid", "password", known with { Disabled = true }));
        lookupJson = "{\"users\":[]}";
        var unknown = await provider.LookupAsync("user@example.invalid");
        AdditionalContracts.Require(unknown.Uid is null && unknown.Key == "unknown-" + Convert.ToHexStringLower(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes("test-hmac-secret"), Encoding.UTF8.GetBytes("user@example.invalid"))), "Unknown account HMAC changed");
        // Render supplies the service account as a Secret File; unknown accounts must still get the HMAC key, not an outage.
        var secretFile = Path.Combine(Path.GetTempPath(), "flowerflow-sa-" + Guid.NewGuid().ToString("N") + ".json");
        await File.WriteAllTextAsync(secretFile, "file-hmac-secret");
        try
        {
            env.Remove("FIREBASE_SERVICE_ACCOUNT_JSON"); env["FIREBASE_SERVICE_ACCOUNT_FILE"] = secretFile;
            var fileProvider = new PasswordAuth(http, accounts, key, false, name => env.GetValueOrDefault(name), () => now);
            var fromFile = await fileProvider.LookupAsync("user@example.invalid");
            AdditionalContracts.Require(fromFile.Uid is null && fromFile.Key == "unknown-" + Convert.ToHexStringLower(HMACSHA256.HashData(
                Encoding.UTF8.GetBytes("file-hmac-secret"), Encoding.UTF8.GetBytes("user@example.invalid"))), "Unknown account HMAC ignored the service-account file");
            env["FIREBASE_SERVICE_ACCOUNT_FILE"] = secretFile + ".missing";
            await Unavailable(() => fileProvider.LookupAsync("user@example.invalid"));
        }
        finally { File.Delete(secretFile); env.Remove("FIREBASE_SERVICE_ACCOUNT_FILE"); env["FIREBASE_SERVICE_ACCOUNT_JSON"] = "test-hmac-secret"; }
        lookupJson = "{\"users\":{}}"; await Unavailable(() => provider.LookupAsync("user@example.invalid"));

        foreach (var values in new[]
        {
            new Dictionary<string, string?>(),
            new Dictionary<string, string?> { ["FIREBASE_AUTH_PUBLIC_API_KEY"] = "same", ["FIREBASE_AUTH_SERVER_API_KEY"] = "same" },
            new Dictionary<string, string?> { ["FIREBASE_AUTH_EMULATOR_HOST"] = "example.com:9099" },
            new Dictionary<string, string?> { ["FIREBASE_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099", ["NODE_ENV"] = "production" }
        })
        {
            try { _ = new PasswordAuth(http, accounts, "same", false, name => values.GetValueOrDefault(name)); throw new Exception("Unsafe auth configuration accepted"); }
            catch (AuthUnavailableException) { }
        }
        try { _ = new PasswordAuth(http, accounts, key, true, name => name == "FIREBASE_AUTH_EMULATOR_HOST" ? "127.0.0.1:9099" : null); throw new Exception("Production emulator accepted"); }
        catch (AuthUnavailableException) { }
        // Google's current error shape names the blocked method in metadata.methodName.
        var currentKey = "current-" + Guid.NewGuid().ToString("N");
        using var currentHttp = new HttpClient(new StubHttpHandler(_ => Task.FromResult(Response(HttpStatusCode.Forbidden,
            "{\"error\":{\"status\":\"PERMISSION_DENIED\",\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.ErrorInfo\",\"reason\":\"API_KEY_SERVICE_BLOCKED\",\"metadata\":{\"service\":\"identitytoolkit.googleapis.com\",\"methodName\":\"google.cloud.identitytoolkit.v1.AuthenticationService.SignInWithPassword\"}},{\"@type\":\"type.googleapis.com/google.rpc.LocalizedMessage\"}]}}"))));
        await new PasswordAuth(currentHttp, accounts, currentKey, false,
            name => name == "FIREBASE_AUTH_PUBLIC_API_KEY" ? currentKey : name == "FIREBASE_AUTH_SERVER_API_KEY" ? "server" : null).AssertReadyAsync();
        var blockedKey = "denied-" + Guid.NewGuid().ToString("N"); var badProbes = 0;
        using var badHttp = new HttpClient(new StubHttpHandler(_ => { badProbes++; return Task.FromResult(Response(HttpStatusCode.Forbidden,
            "{\"error\":{\"details\":[{\"reason\":\"API_KEY_HTTP_REFERRER_BLOCKED\"}]}}")); }));
        var badProvider = new PasswordAuth(badHttp, accounts, blockedKey, false,
            name => name == "FIREBASE_AUTH_PUBLIC_API_KEY" ? blockedKey : name == "FIREBASE_AUTH_SERVER_API_KEY" ? "server" : null);
        await Unavailable(() => badProvider.AssertReadyAsync()); await Unavailable(() => badProvider.AssertReadyAsync());
        AdditionalContracts.Require(badProbes == 2, "Failed public key probe was cached");
        var oldPublicKey = Environment.GetEnvironmentVariable("FIREBASE_AUTH_PUBLIC_API_KEY");
        var oldServerKey = Environment.GetEnvironmentVariable("FIREBASE_AUTH_SERVER_API_KEY");
        try
        {
            Environment.SetEnvironmentVariable("FIREBASE_AUTH_PUBLIC_API_KEY", key); Environment.SetEnvironmentVariable("FIREBASE_AUTH_SERVER_API_KEY", serverKey);
            var hostBuilder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { EnvironmentName = Environments.Development });
            hostBuilder.Services.AddSingleton<IFirebaseAccounts>(accounts); hostBuilder.Services.AddSingleton(new FrontendFirebaseConfig(key));
            hostBuilder.Services.AddHttpClient<PasswordAuth>().ConfigurePrimaryHttpMessageHandler(() => new StubHttpHandler(_ => throw new Exception("Unexpected network call")));
            using var host = hostBuilder.Build();
            AdditionalContracts.Require(host.Services.GetRequiredService<PasswordAuth>() is not null, "Typed HTTP client could not construct password provider");
        }
        finally
        {
            Environment.SetEnvironmentVariable("FIREBASE_AUTH_PUBLIC_API_KEY", oldPublicKey); Environment.SetEnvironmentVariable("FIREBASE_AUTH_SERVER_API_KEY", oldServerKey);
        }
        await LoginDiagnosticsAsync();
        Console.WriteLine("PASS: public-key bypass probes/cache, private password lookup, HMAC unknown accounts, provider faults and production emulator rejection.");
    }

    // A 503 must tell operators which login step failed without exposing anything sensitive to clients or logs.
    private static async Task LoginDiagnosticsAsync()
    {
        foreach (var (failure, stage, reason) in new (Exception Error, string Stage, string Reason)[]
        {
            (new AuthUnavailableException("public-key-mismatch"), "assert-ready", "public-key-mismatch"),
            (new InvalidOperationException("private-provider-detail"), "assert-ready", "InvalidOperationException")
        })
        {
            var logger = new LoginLogger();
            var handler = new LoginHandler(new TestFirebaseAccounts(), () => new FailingPasswordProvider(failure), () => null!, logger);
            var context = new Microsoft.AspNetCore.Http.DefaultHttpContext(); context.Request.Method = "POST";
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{\"email\":\"diag-user@example.invalid\",\"password\":\"Secret-Pass-1\"}"));
            context.Request.ContentType = "application/json"; context.Response.Body = new MemoryStream();
            await handler.HandleAsync(context);
            var body = Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray());
            var log = string.Join("\n", logger.Messages);
            AdditionalContracts.Require(context.Response.StatusCode == 503 && body.Contains("auth-service-unavailable") && !body.Contains(reason),
                "Login diagnostics changed the client response");
            AdditionalContracts.Require(log.Contains(stage) && log.Contains(reason), "Login 503 did not log its failing stage and reason: " + log);
            AdditionalContracts.Require(!log.Contains("diag-user") && !log.Contains("Secret-Pass-1") && !log.Contains("private-provider-detail"),
                "Login diagnostics logged credentials or provider details");
        }
    }
    private sealed class FailingPasswordProvider(Exception failure) : IPasswordAuth
    {
        public Task AssertReadyAsync(CancellationToken cancellationToken = default) => Task.FromException(failure);
        public Task<PasswordAccount> LookupAsync(string email, CancellationToken cancellationToken = default) => throw new InvalidOperationException();
        public Task<bool> VerifyPasswordAsync(string email, string password, PasswordAccount account, CancellationToken cancellationToken = default) => throw new InvalidOperationException();
    }
    private sealed class LoginLogger : Microsoft.Extensions.Logging.ILogger<LoginHandler>
    {
        public List<string> Messages { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;
        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception) + (exception is null ? "" : " " + exception));
    }
    private static HttpResponseMessage Response(HttpStatusCode status, string json) => new(status)
        { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    private static async Task Unavailable(Func<Task> work)
    {
        try { await work(); throw new Exception("Provider outage/misconfiguration accepted"); }
        catch (AuthUnavailableException error) { AdditionalContracts.Require(error.Code == "auth-service-unavailable" && error.InnerException is null, "Provider error leaked"); }
    }
}

sealed class StubHttpHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
}
sealed class TestFirebaseAccounts : IFirebaseAccounts
{
    public string ProjectId => "demo-flowerflow-csharp";
    public int TokenCreations { get; private set; }
    public Dictionary<string, FirebaseAccount> Users { get; } = new();
    public string? LastPageToken { get; private set; }
    public List<string> RevokedUsers { get; } = [];
    public bool FailRevocation { get; set; }
    public void EnsureConfigured() { }
    public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken) => Task.FromResult("access-token");
    public Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken)
    { TokenCreations++; return Task.FromResult("custom-" + uid); }
    public Task<FirebaseUserPage> ListUsersAsync(string? pageToken, CancellationToken cancellationToken)
    { LastPageToken = pageToken; return Task.FromResult(new FirebaseUserPage(Users.Values.Take(100).ToList(), "next-page")); }
    public Task<FirebaseAccount> GetUserAsync(string uid, CancellationToken cancellationToken) =>
        Users.TryGetValue(uid, out var user) ? Task.FromResult(user) : throw new FirebaseAccountException("auth/user-not-found");
    public Task SetCustomClaimsAsync(string uid, IDictionary<string, object> claims, CancellationToken cancellationToken)
    { Users[uid] = Users[uid] with { CustomClaims = new Dictionary<string, object>(claims) }; return Task.CompletedTask; }
    public Task RevokeRefreshTokensAsync(string uid, CancellationToken cancellationToken)
    { if (FailRevocation) throw new Exception("private-provider-detail"); RevokedUsers.Add(uid); return Task.CompletedTask; }
}

sealed class TestPasswordProvider(string key) : IPasswordAuth
{
    public bool Valid { get; set; }
    public bool Outage { get; set; }
    public int Verifications { get; private set; }
    public string? LastEmail { get; private set; }
    public Task AssertReadyAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task<PasswordAccount> LookupAsync(string email, CancellationToken cancellationToken = default)
    { LastEmail = email; return Task.FromResult(new PasswordAccount(key, "login-user", 1)); }
    public Task<bool> VerifyPasswordAsync(string email, string password, PasswordAccount account, CancellationToken cancellationToken = default)
    { Verifications++; if (Outage) throw new Exception("private-provider-detail"); return Task.FromResult(Valid); }
}
