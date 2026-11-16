using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowerFlow.Infrastructure.Local;
using Microsoft.AspNetCore.Http;

static class LocalHttpContracts
{
    public static async Task RunAsync(string root)
    {
        var worker = new FakeWorker(); var handler = new LocalAuthHandler(worker);
        async Task<(DefaultHttpContext Context, JsonNode? Body)> Request(string action, string method = "POST", string? cookie = null)
        {
            var context = new DefaultHttpContext(); context.Request.Method = method; context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{}"));
            if (cookie is not null) context.Request.Headers.Cookie = "flower_local_session=" + cookie;
            context.Response.Body = new MemoryStream(); await handler.HandleAsync(context, action); context.Response.Body.Position = 0;
            return (context, JsonNode.Parse(await new StreamReader(context.Response.Body).ReadToEndAsync()));
        }
        using var cases = await AdditionalContracts.OracleAsync(root, "local-auth-http-oracle.cjs");
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            var result = test.GetProperty("result"); worker.Result = new(result.GetProperty("status").GetInt32(), result.GetProperty("code").GetString(),
                result.TryGetProperty("retryAfter", out var retry) ? retry.GetInt32() : null, 0);
            var actual = await Request("login");
            AdditionalContracts.Require(actual.Context.Response.StatusCode == test.GetProperty("status").GetInt32()
                && JsonNode.DeepEquals(actual.Body, JsonNode.Parse(test.GetProperty("body").GetRawText()))
                && (actual.Context.Response.Headers.RetryAfter.Count == 0 ? null : actual.Context.Response.Headers.RetryAfter.ToString()) == test.GetProperty("retry").GetString()
                && (actual.Context.Response.Headers.SetCookie.Count > 0) == test.GetProperty("cleared").GetBoolean(), "Local HTTP response differs from Node");
        }
        worker.Result = new(Account: new() { ["uid"] = "local-test" }, SessionToken: "secret-session");
        var success = await Request("login");
        AdditionalContracts.Require(success.Body?["account"]?["uid"]?.ToString() == "local-test" && success.Body?["sessionToken"] is null && success.Context.Response.Headers.SetCookie.ToString().Contains("secret-session;"), "Session token escaped cookie-only boundary");
        var absent = await Request("session", "GET", "invalid");
        AdditionalContracts.Require(absent.Context.Response.StatusCode == 401 && absent.Context.Response.Headers.SetCookie.ToString().Contains("Max-Age=0"), "Invalid session cookie not cleared");
        worker.Error = new LocalAccountException("local-auth-busy", "Máy chủ bận. Vui lòng thử lại sau.", 429);
        var busy = await Request("reset"); AdditionalContracts.Require(busy.Context.Response.Headers.RetryAfter == "5" && busy.Body?["retryAfter"]?.GetValue<int>() == 5, "Busy retry-after changed");
        worker.Error = new Exception("private credential detail");
        var failure = await Request("reset"); AdditionalContracts.Require(failure.Context.Response.StatusCode == 503 && !failure.Body!.ToJsonString().Contains("private credential"), "Local worker fault leaked");
        worker.Error = null;
        for (var index = 0; index < 5; index++) await Request("register");
        var limited = await Request("register"); AdditionalContracts.Require(limited.Context.Response.StatusCode == 429 && limited.Body?["code"]?.ToString() == "local-rate-limited", "Registration rate budget changed");
        AdditionalContracts.Require((await Request("unknown")).Context.Response.StatusCode == 404 && (await Request("session")).Context.Response.Headers.Allow == "GET", "Local route/method validation changed");
        Console.WriteLine("PASS: local auth HTTP messages match Node, cookie-only sessions, invalid-cookie clearing, rate limits, busy and generic failures.");
    }
    private sealed class FakeWorker : ILocalAccountWorker
    {
        public LocalAuthResult Result { get; set; } = new(); public Exception? Error { get; set; }
        public Task<LocalAuthResult> ExecuteAsync(string action, JsonElement body, IEnumerable<string>? previous = null, string? token = null) => Error is null ? Task.FromResult(Result) : Task.FromException<LocalAuthResult>(Error);
        public Task<Dictionary<string, object>?> SessionAsync(string? token) => Task.FromResult<Dictionary<string, object>?>(null);
        public Task LogoutAsync(IEnumerable<string> tokens) => Task.CompletedTask;
    }
}
