using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;
using FlowerFlow.Infrastructure.Firebase;

static class AdditionalContracts
{
    public static void AdminAuditEntry()
    {
        var actor = new FirebaseIdentity(new string('u', 200), new Dictionary<string, object> { ["email"] = new string('e', 400) });
        var details = new Dictionary<string, object> { ["before"] = 1, ["after"] = 2 };
        var entry = AdminAudit.MakeEntry(actor, new string('a', 100), new string('r', 100), new string('i', 200), details);
        Require(((string)entry["actorUid"]).Length == 128 && ((string)entry["actorEmail"]).Length == 320
            && ((string)entry["action"]).Length == 80 && ((string)entry["resourceType"]).Length == 80
            && ((string)entry["resourceId"]).Length == 128, "Audit field bounds changed");
        Require(ReferenceEquals(entry["details"], details), "Audit details altered");
        Require(ReferenceEquals(entry["createdAt"], Google.Cloud.Firestore.FieldValue.ServerTimestamp), "Audit must use server timestamp");
        Require(AdminAudit.MakeEntry(null, "action", "resource", null)["details"] is Dictionary<string, object>, "Missing details default changed");
        Require(AdminAudit.MakeEntry(null, "action", "resource", null, null)["details"] is null, "Explicit null details changed");
        Console.WriteLine("PASS: audit entry limits, original details, explicit null, defaults and server timestamp.");
    }

    public static async Task IdentityAsync()
    {
        using var scenario = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\"}}");
        var backend = new FakeBackend(scenario.RootElement);
        var service = new RequestIdentity(backend);
        Require(await service.OptionalCustomerAsync(new DefaultHttpContext()) is null, "Guest must stay anonymous");
        foreach (var header in new[] { "Basic token", "Bearer ", "Bearer token extra" })
        {
            var context = new DefaultHttpContext(); context.Request.Headers.Authorization = header;
            try { await service.OptionalCustomerAsync(context); throw new Exception("Invalid bearer accepted"); }
            catch (RequestIdentityException error) { Require(error.Code == "auth/invalid-session", "Wrong invalid-session code"); }
        }
        var authenticated = new DefaultHttpContext(); authenticated.Request.Headers.Authorization = "bEaReR\ttoken";
        Require((await service.OptionalCustomerAsync(authenticated))?.Uid == "user-a" && backend.CheckRevoked == true,
            "Customer bearer must check revocation");
        var identity = new FirebaseIdentity("local-user", new Dictionary<string, object>());
        var local = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(local, identity, true);
        Require(ReferenceEquals(await service.OptionalCustomerAsync(local), identity), "Trusted local identity lost");
        local.Request.Headers.Authorization = "Bearer token";
        try { await service.OptionalCustomerAsync(local); throw new Exception("Mixed local and bearer accepted"); }
        catch (RequestIdentityException) { }
        var invalid = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(invalid, null, true);
        try { await service.OptionalCustomerAsync(invalid); throw new Exception("Invalid local session accepted"); }
        catch (RequestIdentityException) { }
        var guest = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(guest, null, false);
        Require(await service.OptionalCustomerAsync(guest) is null, "Local guest rejected");
        var cookies = new DefaultHttpContext(); Require(RequestIdentity.SessionCookie(cookies) is null, "Missing cookie changed");
        cookies.Request.Headers.Cookie = "other=1; flower_local_session=one";
        Require(RequestIdentity.SessionCookie(cookies) == "one", "Session cookie not read");
        cookies.Request.Headers.Cookie = "flower_local_session=one; flower_local_session=two";
        Require(RequestIdentity.SessionCookie(cookies) == "", "Ambiguous cookies must fail closed");
        Console.WriteLine("PASS: customer identity, revoked-check flag, trusted local boundary and ambiguous cookies.");
    }

    public static async Task<int> ApiRoutesAsync(string root)
    {
        using var cases = await OracleAsync(root, "api-routes-oracle.cjs");
        var count = 0;
        static RequestDelegate Handler(string name) => context => context.Response.WriteAsJsonAsync(new { handler = name });
        var routes = new ApiRoutes(Handler("default"), new Dictionary<string, RequestDelegate>
        {
            ["audit"] = Handler("audit"), ["bouquet-wrapping"] = Handler("bouquet-wrapping")
        });
        foreach (var scenario in cases.RootElement.EnumerateArray())
        {
            var context = new DefaultHttpContext();
            if (scenario.GetProperty("query").TryGetProperty("route", out var route))
            {
                var values = route.ValueKind == JsonValueKind.Array ? route.EnumerateArray().Select(x => x.GetString()!) : [route.GetString()!];
                context.Request.QueryString = new QueryString("?" + string.Join("&", values.Select(x => "route=" + Uri.EscapeDataString(x))));
            }
            using var stream = new MemoryStream();
            context.Response.Body = stream;
            await routes.InvokeAsync(context);
            stream.Position = 0;
            var body = JsonNode.Parse(await new StreamReader(stream).ReadToEndAsync());
            var actual = JsonSerializer.SerializeToNode(new { status = context.Response.StatusCode, body,
                cache = context.Response.Headers.CacheControl.Count == 0 ? null : context.Response.Headers.CacheControl.ToString() });
            Require(JsonNode.DeepEquals(actual, JsonNode.Parse(scenario.GetProperty("expected").GetRawText())), "API route differs from JS");
            count++;
        }
        Console.WriteLine($"PASS: {count} API route scenarios matched JavaScript.");
        return count;
    }

    public static async Task<int> ImageRulesAsync(string root)
    {
        using var cases = await OracleAsync(root, "image-rules-oracle.cjs");
        var count = 0;
        foreach (var scenario in cases.RootElement.EnumerateArray())
        {
            var input = scenario.TryGetProperty("input", out var value) ? value : default;
            var actual = ImageRules.ValidateReviewPhotos(input)?.Select(Convert.ToBase64String).ToArray();
            Require(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(actual),
                JsonNode.Parse(scenario.GetProperty("expected").GetRawText())), $"Image rules case {count} differs from JS");
            count++;
        }
        Console.WriteLine($"PASS: {count} image rule scenarios matched JavaScript.");
        return count;
    }

    public static async Task<JsonDocument> OracleAsync(string root, string name)
    {
        var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(root, "aspnet/tests/FlowerFlow.Contracts", name));
        using var process = Process.Start(start) ?? throw new Exception("Cannot start Node.js oracle.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        Require(process.ExitCode == 0, "Oracle failed: " + await errors);
        return JsonDocument.Parse(await output);
    }

    public static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
