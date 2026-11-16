using System.Text.Json;
using FlowerFlow.Infrastructure.Accounts;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

static class FirebaseLogoutContracts
{
    public static async Task RunAsync()
    {
        var backend = new LogoutBackend();
        var accounts = new TestFirebaseAccounts();
        var authLog = new CaptureLogger();
        var log = new LogoutLogger();
        var handler = new FirebaseLogoutHandler(new FirebaseAdminService(backend, authLog), accounts, log);
        var count = 0;
        async Task Check(string method, string? token, string json, int status, string query = "", bool local = false)
        {
            var context = new DefaultHttpContext();
            context.Request.Method = method;
            if (token is not null) context.Request.Headers.Authorization = "Bearer " + token;
            context.Request.QueryString = new QueryString(query);
            context.Request.Headers.Cookie = "flowerflow_session=local-cookie-not-firebase";
            if (local) RequestIdentity.SetLocalIdentity(context, new FirebaseIdentity("local-user", new Dictionary<string, object>()), true);
            JsonInput.Cache(context, JsonDocument.Parse(json).RootElement.Clone());
            context.Response.Body = new MemoryStream();
            var prior = accounts.RevokedUsers.Count;
            await handler.HandleAsync(context);
            AdditionalContracts.Require(context.Response.StatusCode == status, $"Logout status {status} expected, got {context.Response.StatusCode}");
            AdditionalContracts.Require(context.Response.Headers.CacheControl == "no-store", "Logout response was cacheable");
            AdditionalContracts.Require(accounts.RevokedUsers.Count == prior + (status == 200 ? 1 : 0), "Unexpected revocation side effect");
            if (status == 405) AdditionalContracts.Require(context.Response.Headers.Allow == "POST", "Missing Allow header");
            context.Response.Body.Position = 0;
            var output = await new StreamReader(context.Response.Body).ReadToEndAsync();
            AdditionalContracts.Require(!output.Contains("private-provider-detail") && !output.Contains("saved-valid-token"), "Sensitive logout response");
            if (status == 200)
            {
                AdditionalContracts.Require(accounts.RevokedUsers[^1] == "verified-caller", "Revocation did not use verified UID");
                using var response = JsonDocument.Parse(output);
                AdditionalContracts.Require(response.RootElement.GetProperty("ok").GetBoolean()
                    && response.RootElement.GetProperty("scope").GetString() == "all", "Wrong logout scope");
            }
            count++;
        }

        foreach (var method in new[] { "GET", "PUT", "DELETE", "OPTIONS" }) await Check(method, "saved-valid-token", "{}", 405);
        await Check("POST", null, "{}", 401);
        await Check("POST", null, "{}", 401, local: true);
        foreach (var token in new[] { "invalid", "expired", "revoked" }) await Check("POST", token, "{}", 401);
        foreach (var body in new[] { "{\"uid\":\"victim\"}", "{\"scope\":\"device\"}", "null", "[]", "true", "\"victim\"" })
            await Check("POST", "saved-valid-token", body, 400);
        await Check("POST", "saved-valid-token", "{}", 400, "?uid=victim");
        await Check("POST", "saved-valid-token", "{}", 200);
        accounts.FailRevocation = true;
        await Check("POST", "saved-valid-token", "{}", 503);
        AdditionalContracts.Require(backend.Checks.All(check => check), "Logout skipped revocation checking");
        var logs = string.Join(" ", authLog.Messages.Concat(log.Messages));
        AdditionalContracts.Require(!logs.Contains("private-provider-detail") && !logs.Contains("saved-valid-token"), "Provider/token leaked to logs");
        Console.WriteLine($"PASS: {count} Firebase logout handler scenarios (mock SDK only): verified caller, method/body/query/local isolation, revoked/expired errors and sanitized failures.");
    }

    private sealed class LogoutBackend : IFirebaseAdminBackend
    {
        public List<bool> Checks { get; } = [];
        public Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken)
        {
            Checks.Add(checkRevoked);
            if (token != "saved-valid-token") throw new Exception("private-provider-detail " + token);
            return Task.FromResult(new FirebaseIdentity("verified-caller", new Dictionary<string, object>()));
        }
        public Task<FirebaseAdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken) => throw new Exception("Logout must not change/check admin roles");
    }
    private sealed class LogoutLogger : ILogger<FirebaseLogoutHandler>
    {
        public List<string> Messages { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
    }
}
