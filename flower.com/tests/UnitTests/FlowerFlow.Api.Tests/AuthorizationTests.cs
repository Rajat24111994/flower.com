using System.Text.Json;
using FlowerFlow.Application.Abstractions;
using FlowerFlow.Application.Common.Http;
using FlowerFlow.Domain.Entities;
using FlowerFlow.Domain.Models;
using FlowerFlow.Infrastructure.Firebase;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FlowerFlow.Api.Tests;

internal sealed class IdentityBackend(string scenario) : IFirebaseAdminService
{
    public int TokenReads { get; private set; }
    public bool? CheckRevoked { get; private set; }
    public Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken)
    {
        TokenReads++; CheckRevoked = checkRevoked;
        if (scenario is "invalid" or "disabled") throw new RequestIdentityException("auth/invalid-session", "private-provider-canary");
        IReadOnlyDictionary<string, object> claims = scenario switch
        {
            "customer" => new Dictionary<string, object>(),
            "string-claim" => new Dictionary<string, object> { ["admin"] = "true", ["role"] = "owner" },
            _ => new Dictionary<string, object> { ["admin"] = true, ["role"] = "owner" }
        };
        return Task.FromResult(new FirebaseIdentity("test-user", claims));
    }
    public Task<AdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken)
    {
        if (scenario == "role-outage") throw new Exception("private-role-canary");
        return Task.FromResult<AdminRole?>(scenario == "revoked-role" ? null : new AdminRole(scenario == "demoted-owner" ? "admin" : "owner"));
    }
}

public sealed class AuthorizationTests
{
    [Theory]
    [InlineData("missing", 401)]
    [InlineData("invalid", 401)]
    [InlineData("disabled", 401)]
    [InlineData("customer", 403)]
    [InlineData("string-claim", 403)]
    [InlineData("revoked-role", 403)]
    [InlineData("demoted-owner", 403)]
    [InlineData("role-outage", 503)]
    [InlineData("owner", 200)]
    public async Task Owner_guard_checks_identity_and_live_role_without_leaking_provider_details(string scenario, int status)
    {
        var backend = new IdentityBackend(scenario);
        var guard = new FirebaseAuthService(backend, NullLogger<FirebaseAuthService>.Instance);
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        if (scenario != "missing") context.Request.Headers.Authorization = "Bearer credential-canary";
        var identity = await guard.VerifyOwnerRequestAsync(context);
        Assert.Equal(status, context.Response.StatusCode);
        Assert.Equal(status == 200, identity is not null);
        if (scenario == "missing") Assert.Equal(0, backend.TokenReads);
        else Assert.True(backend.CheckRevoked);
        context.Response.Body.Position = 0;
        var response = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.DoesNotContain("canary", response);
        if (status != 200) Assert.True(JsonDocument.Parse(response).RootElement.TryGetProperty("code", out _));
    }
}
