using FlowerFlow.Commerce;
using FlowerFlow.InMemory;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Unit")]
public sealed class CompatibilityRegressionTests
{
    private static readonly CatalogTests.Actor Customer = new("customer-a", "customer");
    private static readonly CatalogTests.Actor Owner = new();

    [Fact]
    public async Task Updating_pending_order_preserves_its_original_hold_deadline()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 2)], "", "hcm-q1"));
        var customer = new OrderService(store, Customer, clock); var admin = new OrderService(store, Owner, clock);
        var created = await customer.CreateAsync(CommerceTests.Checkout(quote));
        var original = await customer.GetAsync(created.Id);
        clock.Advance(TimeSpan.FromMinutes(10));
        var updated = await admin.ChangeStatusAsync(created.Id, new("Chờ xác nhận", original.Version, "Cửa hàng đang kiểm tra"));
        Assert.Equal(original.ReservationExpiresAt, updated.ReservationExpiresAt);
        clock.Advance(TimeSpan.FromMinutes(21));
        Assert.Equal(1, await admin.ExpireAsync());
        Assert.Equal(20, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Whitespace_in_idempotency_key_does_not_create_a_second_order()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 2)], "", "hcm-q1"));
        var orders = new OrderService(store, Customer, clock); var request = CommerceTests.Checkout(quote);
        var first = await orders.CreateAsync(request);
        var replay = await orders.CreateAsync(request with { IdempotencyKey = " " + request.IdempotencyKey + " " });
        Assert.Equal(first.Id, replay.Id);
        Assert.Single(await orders.ListAsync());
        Assert.Equal(18, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Quote_uses_the_normalized_ids_returned_by_legacy_validation()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var shopping = new ShoppingService(store, Customer, clock);
        var canonical = await shopping.QuoteAsync(new([new("line-a", 2, "bouquet-rose")], "demo10", "hcm-q1"));
        var padded = await shopping.QuoteAsync(new([new(" line-a ", 2, " bouquet-rose ")], " demo10 ", " hcm-q1 "));
        Assert.Equal(canonical.Totals, padded.Totals);
        Assert.Equal("line-a", Assert.Single(padded.Items).Id);
        Assert.Equal("bouquet-rose", padded.Items[0].ProductId);
    }

    [Fact]
    public async Task Checkout_uses_normalized_delivery_schedule_and_promotion()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 1)], "demo10", "hcm-q1"));
        var request = CommerceTests.Checkout(quote) with { PromotionId = " demo10 ", DeliveryZoneId = " hcm-q1 ",
            DeliveryDate = " 2026-11-17 ", DeliveryTime = " 08:00–11:00 " };
        var service = new OrderService(store, Customer, clock); var created = await service.CreateAsync(request);
        var order = await service.GetAsync(created.Id);
        Assert.Equal("demo10", order.PromotionId);
        Assert.Equal("2026-11-17", order.Customer.DeliveryDate);
        Assert.Equal("hcm-q1", order.DeliveryZone.Id);
    }

    [Fact]
    public async Task Guest_cap_aggregates_normalized_product_ids()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([
            new("first", 3, "bouquet-rose"), new("second", 3, "bouquet-rose")], "", "hcm-q1"));
        var request = CommerceTests.Checkout(quote) with { Items = [new("first", 3, "bouquet-rose"), new("second", 3, " bouquet-rose ")] };
        var guest = new OrderService(store, new CatalogTests.Actor("", ""), clock);
        var exception = await Assert.ThrowsAsync<CommerceException>(() => guest.CreateAsync(request));
        Assert.Equal("guest-quantity-limit", exception.Code);
        Assert.Equal(20, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }
}
