using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Integration")]
public sealed class CheckoutWorkflowTests
{
    private sealed class Factory(CommerceTests.Clock clock) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Testing")
            .ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
            });
    }

    [Fact]
    public async Task Http_normalized_quote_and_replayed_checkout_reserve_inventory_once()
    {
        var clock = new CommerceTests.Clock(); await using var factory = new Factory(clock);
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        var quote = await Read<QuoteResponse>(await client.PostAsJsonAsync("/api/v1/quotes",
            new QuoteRequest([new(" line-a ", 2, " bouquet-rose ")], " demo10 ", " hcm-q1 ")));
        var canonicalKey = Guid.NewGuid().ToString();
        var request = CommerceTests.Checkout(quote, key: canonicalKey) with
        {
            Items = [new(" line-a ", 2, " bouquet-rose ")], PromotionId = " demo10 ", DeliveryZoneId = " hcm-q1 ",
            DeliveryDate = " 2026-11-17 ", DeliveryTime = " 08:00–11:00 ", IdempotencyKey = " " + canonicalKey + " "
        };
        var first = await Read<CreatedOrder>(await client.PostAsJsonAsync("/api/v1/orders", request), HttpStatusCode.Created);
        var replay = await Read<CreatedOrder>(await client.PostAsJsonAsync("/api/v1/orders", request with
        { IdempotencyKey = canonicalKey, DeliveryDate = "2026-11-17", DeliveryTime = "08:00–11:00" }), HttpStatusCode.Created);
        Assert.Equal(first.Id, replay.Id); Assert.Equal(840000, replay.Totals.Total);
        Assert.Single((await client.GetFromJsonAsync<OrderResponse[]>("/api/v1/orders"))!);
        var product = await client.GetFromJsonAsync<ProductResponse>("/api/v1/products/bouquet-rose");
        Assert.Equal(18, product!.Quantity);
    }

    [Fact]
    public async Task Http_pending_update_keeps_deadline_and_expiration_restores_stock_once()
    {
        var clock = new CommerceTests.Clock(); await using var factory = new Factory(clock);
        using var customer = factory.CreateClient(); using var owner = factory.CreateClient();
        customer.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        owner.DefaultRequestHeaders.Add("X-Development-User", "owner");
        var quote = await Read<QuoteResponse>(await customer.PostAsJsonAsync("/api/v1/quotes", new QuoteRequest([new("bouquet-rose", 2)], "", "hcm-q1")));
        var created = await Read<CreatedOrder>(await customer.PostAsJsonAsync("/api/v1/orders", CommerceTests.Checkout(quote, "qr")), HttpStatusCode.Created);
        var original = (await customer.GetFromJsonAsync<OrderResponse>($"/api/v1/orders/{created.Id}"))!;
        clock.Advance(TimeSpan.FromMinutes(10));
        var updated = await Read<OrderResponse>(await owner.PutAsJsonAsync($"/api/v1/orders/{created.Id}/status",
            new OrderStatusRequest("Chờ xác nhận", original.Version, "Đang kiểm tra")));
        Assert.Equal(original.ReservationExpiresAt, updated.ReservationExpiresAt);
        clock.Advance(TimeSpan.FromMinutes(21));
        Assert.Equal(1, (await Read<JsonElement>(await owner.PostAsync("/api/v1/orders/expire", null))).GetProperty("released").GetInt32());
        Assert.Equal(0, (await Read<JsonElement>(await owner.PostAsync("/api/v1/orders/expire", null))).GetProperty("released").GetInt32());
        Assert.Equal("Đã hủy", (await customer.GetFromJsonAsync<OrderResponse>($"/api/v1/orders/{created.Id}"))!.Status);
        Assert.Equal(20, (await customer.GetFromJsonAsync<ProductResponse>("/api/v1/products/bouquet-rose"))!.Quantity);
    }

    [Fact]
    public async Task Http_gateway_failure_retry_and_additional_payment_do_not_duplicate_inventory_changes()
    {
        var clock = new CommerceTests.Clock(); await using var factory = new Factory(clock);
        using var customer = factory.CreateClient(); using var owner = factory.CreateClient();
        customer.DefaultRequestHeaders.Add("X-Development-User", "customer-a");
        owner.DefaultRequestHeaders.Add("X-Development-User", "owner");
        var quote = await Read<QuoteResponse>(await customer.PostAsJsonAsync("/api/v1/quotes", new QuoteRequest([new("bouquet-rose", 2)], "", "hcm-q1")));
        var order = await Read<CreatedOrder>(await customer.PostAsJsonAsync("/api/v1/orders", CommerceTests.Checkout(quote, "vnpay")), HttpStatusCode.Created);
        var first = await Read<PaymentAttemptResponse>(await customer.PostAsync($"/api/v1/orders/{order.Id}/payments", null), HttpStatusCode.Created);
        await Read<PaymentAttemptResponse>(await owner.PostAsJsonAsync($"/api/v1/payments/{first.Id}/simulation", new SimulatePaymentRequest("failed", quote.Totals.Total, "SIM-FAIL")));
        Assert.Equal(18, (await customer.GetFromJsonAsync<ProductResponse>("/api/v1/products/bouquet-rose"))!.Quantity);
        clock.Advance(TimeSpan.FromMinutes(16));
        var retry = await Read<PaymentAttemptResponse>(await customer.PostAsync($"/api/v1/payments/{first.Id}/retry", null));
        Assert.NotEqual(first.Id, retry.Id);
        var successful = new SimulatePaymentRequest("paid", quote.Totals.Total, "SIM-PAID");
        await Read<PaymentAttemptResponse>(await owner.PostAsJsonAsync($"/api/v1/payments/{retry.Id}/simulation", successful));
        await Read<PaymentAttemptResponse>(await owner.PostAsJsonAsync($"/api/v1/payments/{retry.Id}/simulation", successful));
        var additional = await Read<PaymentAttemptResponse>(await owner.PostAsJsonAsync($"/api/v1/payments/{first.Id}/simulation",
            new SimulatePaymentRequest("paid", quote.Totals.Total, "SIM-ADDITIONAL")));
        Assert.True(additional.LatePayment);
        var paidOrder = (await customer.GetFromJsonAsync<OrderResponse>($"/api/v1/orders/{order.Id}"))!;
        Assert.True(paidOrder.PaymentVerified); Assert.NotEmpty(paidOrder.PaymentAttention);
        Assert.Equal(retry.Id, paidOrder.CurrentPaymentId);
        Assert.Equal(18, (await customer.GetFromJsonAsync<ProductResponse>("/api/v1/products/bouquet-rose"))!.Quantity);
        Assert.Equal(3, (await owner.GetFromJsonAsync<PaymentAuditResponse[]>($"/api/v1/orders/{order.Id}/payment-audit"))!.Length);
    }

    private static async Task<T> Read<T>(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response)
        {
            Assert.True(response.StatusCode == expected, $"Expected {expected}; received {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }
    }
}
