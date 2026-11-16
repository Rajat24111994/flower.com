using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlowerFlow.Application.Commerce;
using FlowerFlow.Application.Orders;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Integration")]
public sealed class WorkflowApiTests
{
    [Fact]
    public async Task Http_cart_quote_checkout_qr_delivery_review_and_moderation_work_together()
    {
        await using var factory = new ApiTests.Factory();
        using var customer = factory.CreateClient(); using var admin = factory.CreateClient(); using var stranger = factory.CreateClient();
        customer.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        admin.DefaultRequestHeaders.Add("X-Development-User", "admin");
        stranger.DefaultRequestHeaders.Add("X-Development-User", "customer-b");
        var items = new CartLine[] { new("bouquet-rose", 2) };
        Assert.Equal(HttpStatusCode.OK, (await customer.PutAsJsonAsync("/api/v1/cart", new CartRequest(items, 0))).StatusCode);
        var quote = await Read<QuoteResponse>(await customer.PostAsJsonAsync("/api/v1/quotes", new QuoteRequest(items, "", "hcm-q1")));
        var tomorrow = DateOnly.Parse(OrderValidation.VietnameseDate()).AddDays(1).ToString("yyyy-MM-dd");
        var request = CommerceTests.Checkout(quote, "qr") with { DeliveryDate = tomorrow };
        using var creation = await customer.PostAsJsonAsync("/api/v1/orders", request);
        Assert.Equal(HttpStatusCode.Created, creation.StatusCode);
        var created = (await creation.Content.ReadFromJsonAsync<CreatedOrder>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/orders/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.PutAsJsonAsync($"/api/v1/orders/{created.Id}/status", new OrderStatusRequest("Đang chuẩn bị", 1))).StatusCode);
        await Read<PaymentAudit>(await admin.PostAsJsonAsync($"/api/v1/orders/{created.Id}/qr-reconciliation", new ReconciliationRequest(created.Totals.Total, "BANK-TEST")));
        var order = (await customer.GetFromJsonAsync<Order>($"/api/v1/orders/{created.Id}"))!;
        order = await Read<Order>(await admin.PutAsJsonAsync($"/api/v1/orders/{created.Id}/status", new OrderStatusRequest("Đang chuẩn bị", order.Version)));
        order = await Read<Order>(await admin.PutAsJsonAsync($"/api/v1/orders/{created.Id}/status", new OrderStatusRequest("Đang giao", order.Version, "Quận 1", tomorrow)));
        await Read<Order>(await admin.PutAsJsonAsync($"/api/v1/orders/{created.Id}/status", new OrderStatusRequest("Đã giao", order.Version)));
        var review = await Read<ReviewResponse>(await customer.PostAsJsonAsync("/api/v1/reviews", new ReviewRequest(created.Id, 5, "Hoa đẹp", [])));
        using var anonymous = factory.CreateClient();
        Assert.Empty((await anonymous.GetFromJsonAsync<ReviewResponse[]>("/api/v1/reviews"))!);
        await Read<ReviewResponse>(await admin.PutAsJsonAsync($"/api/v1/reviews/{review.Id}/moderation", new ReviewModerationRequest("approved", review.Version)));
        var publicReview = Assert.Single((await anonymous.GetFromJsonAsync<ReviewResponse[]>("/api/v1/reviews"))!);
        Assert.Equal("Hoa đẹp", publicReview.Comment);
        var publicJson = await anonymous.GetStringAsync("/api/v1/reviews");
        Assert.DoesNotContain(created.Id, publicJson); Assert.DoesNotContain("customer-a", publicJson);
    }

    [Fact]
    public async Task Role_changes_apply_to_the_next_request_and_owner_cannot_demote_self()
    {
        await using var factory = new ApiTests.Factory(); using var owner = factory.CreateClient(); using var customer = factory.CreateClient();
        owner.DefaultRequestHeaders.Add("X-Development-User", "owner"); customer.DefaultRequestHeaders.Add("X-Development-User", "customer-b");
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync("/api/v1/admin/users/customer-b/role", new UserRoleRequest("admin"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync("/api/v1/admin/users/customer-b/role", new UserRoleRequest("customer"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/admin/users/owner/role", new UserRoleRequest("customer"))).StatusCode);
        var audit = await owner.GetFromJsonAsync<Page<AuditEntry>>("/api/v1/admin/audit");
        Assert.Equal(2, audit!.Total);
    }

    [Fact]
    public async Task Unknown_development_identity_is_not_treated_as_a_guest()
    {
        await using var factory = new ApiTests.Factory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "invented-owner");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/products")).StatusCode);
    }

    [Fact]
    public async Task Simulator_cannot_be_used_by_customer_and_invalid_nested_input_returns_400()
    {
        await using var factory = new ApiTests.Factory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/payments/anything/simulation",
            new SimulatePaymentRequest("paid", 1000, "FAKE"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/quotes", new { items = new object?[] { null } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/design-requests", new { design = (object?)null })).StatusCode);
    }

    [Fact]
    public async Task Invalid_storage_configuration_is_rejected_on_startup()
    {
        await using var factory = new BadConfiguration();
        var exception = await Assert.ThrowsAnyAsync<Exception>(() => Task.Run(() => factory.CreateClient()));
        Assert.Contains("Only InMemory", exception.ToString());
    }
    private sealed class BadConfiguration : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Testing")
            .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Backend:Storage"] = "SqlServer" }));
    }

    [Fact]
    public async Task Development_identity_host_refuses_production_environment()
    {
        await using var factory = new ProductionFactory();
        var exception = await Assert.ThrowsAnyAsync<Exception>(() => Task.Run(() => factory.CreateClient()));
        Assert.Contains("requires Development or Testing", exception.ToString());
    }
    private sealed class ProductionFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Production");
    }

    private static async Task<T> Read<T>(HttpResponseMessage response)
    {
        using (response)
        {
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }
    }
}
