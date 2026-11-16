using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

static class BackendServerContracts
{
    public static async Task RunAsync(string root)
    {
        var frontend = Path.Combine(root, "flower.com");
        var options = new BackendServerOptions(frontend, true, "firebase")
        { ApiPaths = new HashSet<string>(new BackendServerOptions(frontend, true).ApiPaths.Append("/api/echo").Append("/api/broken"), StringComparer.Ordinal) };
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development", Args = [] });
        builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        app.Use(next => new BackendServer(next, options).InvokeAsync); app.UseRouting();
        RequestDelegate echo = async context => await context.Response.WriteAsJsonAsync(new
        {
            body = await JsonInput.ReadAsync(context), query = context.Request.Query.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray()),
            ip = context.Request.Headers["x-forwarded-for"].ToString()
        });
        app.Map("/api/echo", echo); app.Map("/api/login", echo); app.Map("/api/products", echo); app.Map("/api/flower-prices", echo);
        app.Map("/api/broken", (RequestDelegate)(_ => throw new Exception("private credential detail")));
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(30) };
        using var page = await client.GetAsync("/login.html");
        var html = await page.Content.ReadAsStringAsync();
        AdditionalContracts.Require(page.StatusCode == HttpStatusCode.OK && html.Contains("id=\"signIn\"") && html.Contains("<script src=\"/__local/auth-runtime.js\"></script>"), "Unchanged frontend/login HTML unavailable");
        AdditionalContracts.Require(page.Headers.GetValues("Content-Security-Policy").Single().Contains("script-src 'self' https://www.gstatic.com https://apis.google.com") && !page.Headers.GetValues("Content-Security-Policy").Single().Contains("upgrade-insecure-requests")
            && page.Headers.GetValues("X-Frame-Options").Single() == "DENY", "Development security headers changed");
        using var head = await client.SendAsync(new HttpRequestMessage(HttpMethod.Head, "/login.html"));
        AdditionalContracts.Require(head.Content.Headers.ContentLength == Encoding.UTF8.GetByteCount(html) && (await head.Content.ReadAsByteArrayAsync()).Length == 0, "Static HEAD differs from GET length");
        AdditionalContracts.Require(await client.GetStringAsync("/__local/auth-runtime.js") == "window.FlowerAuthMode = \"firebase\";", "Auth mode runtime endpoint changed");
        foreach (var path in new[] { "/.env", "/.env.example", "/legacy-node/backend/shared/firebase-admin.js", "/scripts/dev.js", "/node_modules/firebase-admin/package.json", "/package.json", "/firebase.json", "/vercel.json", "/firestore.rules", "/.tools/log", "/images/..%5c.env", "/api/UNKNOWN", "/api/orders/", "/api/missing" })
            AdditionalContracts.Require((await client.GetAsync(path)).StatusCode == HttpStatusCode.NotFound, "Internal/unknown path exposed: " + path);
        AdditionalContracts.Require((await client.GetAsync("/js/core/firebase-config.js")).StatusCode == HttpStatusCode.OK && (await client.GetAsync("/flower.json")).StatusCode == HttpStatusCode.OK, "Public frontend assets blocked");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/echo?label=a&label=b") { Content = JsonContent.Create(new { email = "customer@example.invalid" }) };
        request.Headers.TryAddWithoutValidation("x-forwarded-for", "attacker");
        using var echoed = await client.SendAsync(request); var data = await echoed.Content.ReadFromJsonAsync<JsonElement>();
        AdditionalContracts.Require(data.GetProperty("ip").GetString() == "127.0.0.1" && data.GetProperty("query").GetProperty("label").GetArrayLength() == 2 && data.GetProperty("body").GetProperty("email").GetString() == "customer@example.invalid", "JSON/query/IP boundary differs from Node");
        using var rewrite = await client.GetAsync("/api/flower-prices?route=evil&route=other");
        var rewritten = await rewrite.Content.ReadFromJsonAsync<JsonElement>();
        AdditionalContracts.Require(rewritten.GetProperty("query").GetProperty("route")[0].GetString() == "flower-prices" && rewritten.GetProperty("query").GetProperty("route").GetArrayLength() == 1, "Legacy alias did not override duplicate route parameters");
        foreach (var test in new[] { ("{bad", "application/json", 400), ("{}", "text/plain", 415), ("{\"password\":\"" + new string('x',33000) + "\"}", "application/json", 413) })
        {
            using var response = await client.PostAsync("/api/login", new StringContent(test.Item1, Encoding.UTF8, test.Item2));
            AdditionalContracts.Require((int)response.StatusCode == test.Item3, "API JSON input boundary changed");
        }
        using var crossOrigin = new HttpRequestMessage(HttpMethod.Post, "/api/login") { Content = JsonContent.Create(new { }) }; crossOrigin.Headers.Add("Origin", "http://attacker.invalid");
        AdditionalContracts.Require((await client.SendAsync(crossOrigin)).StatusCode == HttpStatusCode.Forbidden, "Cross-origin API call accepted");
        using var rebind = new HttpRequestMessage(HttpMethod.Get, "/login.html"); rebind.Headers.Host = "attacker.invalid";
        AdditionalContracts.Require((await client.SendAsync(rebind)).StatusCode == HttpStatusCode.Forbidden, "Development DNS rebinding accepted");
        using var broken = await client.GetAsync("/api/broken");
        AdditionalContracts.Require((int)broken.StatusCode == 500 && !(await broken.Content.ReadAsStringAsync()).Contains("private credential"), "Server error disclosed exception text");
        var direct = new BackendServer(_ => Task.CompletedTask, options);
        var accepted = false;
        var proxied = new BackendServer(context => { accepted = true; context.Response.StatusCode = 204; return Task.CompletedTask; },
            new(frontend, false) { PublicOrigins = new HashSet<string> { "https://flowerflow-contract.onrender.com" } });
        foreach (var origin in new[] { "https://flowerflow-contract.onrender.com", "https://attacker.invalid" })
        {
            accepted = false; var context = new DefaultHttpContext(); context.Request.Method = "POST"; context.Request.Scheme = "http";
            context.Request.Host = new("flowerflow-contract.onrender.com"); context.Request.Path = "/api/login"; context.Request.Headers.Origin = origin;
            context.Request.Headers["X-Forwarded-For"] = "attacker-controlled"; context.Connection.RemoteIpAddress = IPAddress.Loopback;
            context.Response.Body = new MemoryStream();
            await proxied.InvokeAsync(context);
            AdditionalContracts.Require(accepted == (origin == "https://flowerflow-contract.onrender.com"), "Production public origin validation failed");
            if (accepted) AdditionalContracts.Require(context.Request.Headers["X-Forwarded-For"] == "127.0.0.1", "Public origin trust changed the client IP trust boundary");
            else AdditionalContracts.Require(context.Response.StatusCode == 403, "Unconfigured public origin was accepted");
        }
        foreach (var raw in new[] { "/%FF", "/%ZZ" })
        {
            var context = new DefaultHttpContext(); context.Request.Host = new HostString("127.0.0.1:3000"); context.Features.Get<IHttpRequestFeature>()!.RawTarget = raw; context.Response.Body = new MemoryStream();
            await direct.InvokeAsync(context); AdditionalContracts.Require(context.Response.StatusCode == 400, "Malformed URL was not rejected");
        }
        if (!OperatingSystem.IsWindows())
        {
            var directory = Path.Combine(Path.GetTempPath(), "flowerflow-static-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
            try
            {
                File.Copy(Path.Combine(frontend, "vercel.json"), Path.Combine(directory,"vercel.json"));
                Directory.CreateDirectory(Path.Combine(directory,"js")); Directory.CreateDirectory(Path.Combine(directory,"private"));
                await File.WriteAllTextAsync(Path.Combine(directory,"private","secret.js"), "private");
                Directory.CreateSymbolicLink(Path.Combine(directory,"js","linked"), Path.Combine(directory,"private"));
                var fixture = new BackendServer(_ => Task.CompletedTask, new(directory,true));
                var context = new DefaultHttpContext(); context.Request.Method = "GET"; context.Request.Host = new("127.0.0.1:3000"); context.Request.Path = "/js/linked/secret.js"; context.Response.Body = new MemoryStream();
                await fixture.InvokeAsync(context); AdditionalContracts.Require(context.Response.StatusCode == 404, "Parent symlink exposed a private target");
            }
            finally
            {
                // Delete only the fixture's known paths; remove the link itself before its target.
                var linked = Path.Combine(directory,"js","linked");
                if (Directory.Exists(linked)) Directory.Delete(linked);
                File.Delete(Path.Combine(directory,"private","secret.js"));
                if (Directory.Exists(Path.Combine(directory,"private"))) Directory.Delete(Path.Combine(directory,"private"));
                if (Directory.Exists(Path.Combine(directory,"js"))) Directory.Delete(Path.Combine(directory,"js"));
                File.Delete(Path.Combine(directory,"vercel.json")); Directory.Delete(directory);
            }
        }
        await app.StopAsync();
        Console.WriteLine("PASS: ASP.NET socket HTTP frontend/static/API routing, legacy aliases, JSON limits, CSP, host/origin protection and untrusted forwarded IP rejection.");
    }
}
