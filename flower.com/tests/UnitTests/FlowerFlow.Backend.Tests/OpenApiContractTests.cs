using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Integration")]
public sealed class OpenApiContractTests
{
    [Theory]
    [InlineData("/api/v1/products", "post", "201")]
    [InlineData("/api/v1/categories", "post", "201")]
    [InlineData("/api/v1/orders", "post", "201")]
    [InlineData("/api/v1/reviews", "post", "201")]
    [InlineData("/api/v1/design-requests", "post", "201")]
    [InlineData("/api/v1/orders/{orderId}/payments", "post", "201")]
    [InlineData("/api/v1/products/{id}", "delete", "204")]
    [InlineData("/api/v1/categories/{id}", "delete", "204")]
    public async Task OpenApi_documents_the_status_actually_returned_by_resource_mutations(string path, string method, string status)
    {
        await using var factory = new ApiTests.Factory(); using var client = factory.CreateClient();
        var document = await client.GetFromJsonAsync<JsonElement>("/openapi/v1.json");
        var responses = document.GetProperty("paths").GetProperty(path).GetProperty(method).GetProperty("responses");
        Assert.True(responses.TryGetProperty(status, out _), $"{method.ToUpperInvariant()} {path} must document {status}.");
        Assert.False(responses.TryGetProperty("200", out _), $"{method.ToUpperInvariant()} {path} does not return 200 on success.");
    }
}
