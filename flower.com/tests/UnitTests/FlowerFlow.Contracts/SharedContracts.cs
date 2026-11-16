using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

static class SharedContracts
{
    public static async Task RunAsync(string root)
    {
        using var cases = await AdditionalContracts.OracleAsync(root, "shared-helpers-oracle.cjs");
        var count = 0;
        foreach (var test in cases.RootElement.GetProperty("authentication").EnumerateArray())
        {
            var backend = new SharedBackend();
            var context = new DefaultHttpContext();
            context.Request.Headers.Authorization = test.GetProperty("authorization").GetString();
            using var stream = new MemoryStream(); context.Response.Body = stream;
            FirebaseIdentity? user = null; string? error = null;
            try
            {
                user = test.GetProperty("method").GetString() == "request"
                    ? await new FirebaseAuthService(backend, NullLogger<FirebaseAuthService>.Instance).VerifyRequestAsync(context)
                    : await new RequestIdentityService(backend).OptionalCustomerAsync(context);
            }
            catch (RequestIdentityException failure) { error = failure.Code; }
            var actual = new { uid = user?.Uid, error, status = context.Response.StatusCode,
                body = stream.Length == 0 ? null : JsonNode.Parse(Encoding.UTF8.GetString(stream.ToArray())),
                verifiedToken = backend.Token, checkRevoked = backend.CheckRevoked };
            Match(actual, test); count++;
        }
        foreach (var test in cases.RootElement.GetProperty("local").EnumerateArray())
        {
            var backend = new SharedBackend(); var context = new DefaultHttpContext();
            var account = test.GetProperty("account");
            RequestIdentityService.SetLocalIdentity(context, account.ValueKind == JsonValueKind.Null ? null
                : new FirebaseIdentity(account.GetProperty("uid").GetString()!, new Dictionary<string, object>()), test.GetProperty("presented").GetBoolean());
            context.Request.Headers.Authorization = test.GetProperty("authorization").GetString();
            FirebaseIdentity? user = null; string? error = null;
            try { user = await new RequestIdentityService(backend).OptionalCustomerAsync(context); }
            catch (RequestIdentityException failure) { error = failure.Code; }
            Match(new { uid = user?.Uid, error }, test);
            AdditionalContracts.Require(backend.Token == null, "Local identity must not invoke Firebase verification"); count++;
        }
        foreach (var test in cases.RootElement.GetProperty("audit").EnumerateArray())
        {
            var actor = test.GetProperty("actor");
            var identity = new FirebaseIdentity(actor.GetProperty("uid").GetString()!, new Dictionary<string, object> { ["email"] = Js.Object(actor.GetProperty("email"))! });
            var entry = test.TryGetProperty("details", out var details)
                ? AdminAuditRepository.MakeEntry(identity, new string('a', 81), new string('r', 81), new string('i', 129), Js.Object(details))
                : AdminAuditRepository.MakeEntry(identity, new string('a', 81), new string('r', 81), new string('i', 129));
            AdditionalContracts.Require(ReferenceEquals(entry["createdAt"], FieldValue.ServerTimestamp), "Audit must retain the server timestamp sentinel");
            entry["createdAt"] = "server-timestamp"; Match(entry, test); count++;
        }
        foreach (var test in cases.RootElement.GetProperty("routes").EnumerateArray())
        {
            static Task Named(HttpContext context, string name) => context.Response.WriteAsJsonAsync(new { handler = name });
            var routes = new ApiRoutes(context => Named(context, "default"), new Dictionary<string, RequestDelegate> { ["audit"] = context => Named(context, "audit") });
            var context = new DefaultHttpContext(); var query = test.GetProperty("query");
            if (query.TryGetProperty("route", out var route))
            {
                var values = route.ValueKind == JsonValueKind.Array ? route.EnumerateArray().Select(item => item.GetString()!) : [route.GetString()!];
                context.Request.QueryString = new QueryString("?" + string.Join("&", values.Select(value => "route=" + Uri.EscapeDataString(value))));
            }
            using var stream = new MemoryStream(); context.Response.Body = stream; await routes.InvokeAsync(context);
            Match(new { status = context.Response.StatusCode, body = JsonNode.Parse(Encoding.UTF8.GetString(stream.ToArray())),
                cache = context.Response.Headers.CacheControl.Count == 0 ? null : context.Response.Headers.CacheControl.ToString() }, test); count++;
        }
        Console.WriteLine($"PASS: {count} shared backend cases match actual JS authentication, local identity, audit and route helpers.");
    }
    private static void Match(object actual, JsonElement test) => AdditionalContracts.Require(
        JsonNode.DeepEquals(JsonSerializer.SerializeToNode(actual), JsonNode.Parse(test.GetProperty("expected").GetRawText())),
        "Shared helper differs from JavaScript: " + test.GetRawText() + "; actual: " + JsonSerializer.Serialize(actual));
    private sealed class SharedBackend : IFirebaseAdminService
    {
        public string? Token { get; private set; }
        public bool? CheckRevoked { get; private set; }
        public Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken)
        {
            Token = token; CheckRevoked = checkRevoked;
            if (token == "revoked") throw new RequestIdentityException("auth/fixture-failure", "fixture-failure");
            return Task.FromResult(new FirebaseIdentity("firebase-user", new Dictionary<string, object>()));
        }
        public Task<AdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken) => throw new InvalidOperationException("Unexpected role read");
    }
}
