using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;

static class AdditionalContracts
{
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
