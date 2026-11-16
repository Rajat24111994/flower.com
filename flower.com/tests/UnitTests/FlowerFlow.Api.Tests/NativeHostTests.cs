using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlowerFlow.Application.Abstractions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace FlowerFlow.Api.Tests;

public sealed class NativeHostTests
{
    private sealed class Host(string scenario) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing"); // Firebase mode, no local worker or production credentials.
            // Windows EventLog is unavailable in a restricted test process. Keep a usable
            // logger so error-path assertions observe the API rather than a logging failure.
            builder.ConfigureLogging(logging => { logging.ClearProviders(); logging.AddConsole(); });
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IFirebaseAdminService>();
                services.AddSingleton<IFirebaseAdminService>(new IdentityBackend(scenario));
            });
        }
    }

    [Theory]
    [InlineData("missing", 401)]
    [InlineData("invalid", 401)]
    [InlineData("customer", 403)]
    [InlineData("string-claim", 403)]
    [InlineData("revoked-role", 403)]
    [InlineData("demoted-owner", 403)]
    [InlineData("role-outage", 503)]
    public async Task Real_controller_pipeline_enforces_owner_guard(string scenario, int expected)
    {
        await using var factory = new Host(scenario); using var client = factory.CreateClient();
        if (scenario != "missing") client.DefaultRequestHeaders.Add("Authorization", "Bearer test-token");
        using var response = await client.GetAsync("/api/wilting-prices");
        Assert.Equal(expected, (int)response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("canary", body);
        Assert.True(JsonDocument.Parse(body).RootElement.TryGetProperty("code", out _));
    }

    [Fact]
    public async Task Nondevelopment_host_exposes_health_but_never_local_account_endpoints()
    {
        await using var factory = new Host("customer"); using var client = factory.CreateClient();
        Assert.Equal("ok", (await client.GetFromJsonAsync<JsonElement>("/health")).GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/local-auth/session")).StatusCode);
    }

    [Fact]
    public async Task Forged_origin_is_rejected_before_the_mutating_controller()
    {
        await using var factory = new Host("owner"); using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/wilting-prices") { Content = JsonContent.Create(new { action = "save-rules" }) };
        request.Headers.Add("Origin", "https://attacker.invalid");
        request.Headers.Add("X-Forwarded-Proto", "https");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
