using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlowerFlow.Application.Commerce;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FlowerFlow.Backend.Tests;

public sealed class ApiTests
{
    internal sealed class Factory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Testing");
    }

    [Fact]
    public async Task Host_exposes_OpenApi_and_Swagger_without_Firebase_or_database()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient();
        var health = await client.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("InMemory", health.GetProperty("storage").GetString());
        var specification = await client.GetFromJsonAsync<JsonElement>("/openapi/v1.json");
        Assert.True(specification.GetProperty("paths").TryGetProperty("/api/v1/products", out _));
        Assert.Contains("swagger-ui", await client.GetStringAsync("/swagger/index.html"));
    }

    [Fact]
    public async Task Anonymous_and_customer_cannot_write_and_admin_cannot_set_flower_price()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient();
        var request = new CategoryRequest("Hoa mới");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/categories", request)).StatusCode);
        client.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/categories", request)).StatusCode);
        client.DefaultRequestHeaders.Remove("X-Development-User"); client.DefaultRequestHeaders.Add("X-Development-User", "admin");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/api/v1/products/stem-rose/flower-price", new PriceRequest(30000, 1))).StatusCode);
    }

    [Fact]
    public async Task Category_creation_returns_location_and_duplicate_returns_ProblemDetails()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "admin");
        using var created = await client.PostAsJsonAsync("/api/v1/categories", new CategoryRequest("Hoa mới"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode); Assert.NotNull(created.Headers.Location);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(created.Headers.Location)).StatusCode);
        using var duplicate = await client.PostAsJsonAsync("/api/v1/categories", new CategoryRequest("Hoa mới"));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        var problem = await duplicate.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("category-exists", problem.GetProperty("code").GetString());
        Assert.True(problem.TryGetProperty("traceId", out _));
    }

    [Fact]
    public async Task Invalid_input_is_400_and_unknown_resources_are_404()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "admin");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/categories", new { name = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/products?page=0")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/products/nonexistent")).StatusCode);
    }

    [Fact]
    public async Task Hidden_products_are_excluded_and_stale_version_cannot_change_stock()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "admin");
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/v1/products/bouquet-rose?expectedVersion=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/products/bouquet-rose")).StatusCode);
        var stock = await client.PostAsJsonAsync("/api/v1/products/bouquet-rose/inventory-adjustments", new InventoryRequest(1, "Nhập kho", 1));
        Assert.Equal(HttpStatusCode.Conflict, stock.StatusCode);
    }
}
