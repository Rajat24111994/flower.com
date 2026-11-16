using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using FlowerFlow.InMemory;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Unit")]
public sealed class RegressionTests
{
    private static readonly CatalogTests.Actor Owner = new();
    private static readonly CatalogTests.Actor Customer = new("customer-a", "customer");

    [Fact]
    public async Task Failed_gateway_result_keeps_stock_until_expiry_and_retry_reserves_again()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var shopping = new ShoppingService(store, Customer, clock); var orders = new OrderService(store, Customer, clock);
        var created = await orders.CreateAsync(CommerceTests.Checkout(await shopping.QuoteAsync(new([new("bouquet-rose", 2)], "", "hcm-q1")), "vnpay"));
        var payments = new PaymentService(store, Customer, new SimulatedPaymentGateway(), clock);
        var attempt = await payments.CreateAttemptAsync(created.Id);
        await new PaymentService(store, Owner, new SimulatedPaymentGateway(), clock).SimulateAsync(attempt.Id, new("failed", created.Totals.Total, "FAILED-1"));
        Assert.Equal("reserved", (await orders.GetAsync(created.Id)).InventoryState);
        var catalog = new CatalogService(store, Owner, clock);
        Assert.Equal(18, (await catalog.ProductAsync("bouquet-rose")).Quantity);
        clock.Advance(TimeSpan.FromMinutes(16)); await orders.ExpireAsync();
        Assert.Equal(20, (await catalog.ProductAsync("bouquet-rose")).Quantity);
        var retry = await payments.RetryAsync(attempt.Id);
        Assert.NotEqual(attempt.Id, retry.Id); Assert.Equal("pending", retry.Status);
        Assert.Equal(18, (await catalog.ProductAsync("bouquet-rose")).Quantity);
        Assert.Equal("Chờ xác nhận", (await orders.GetAsync(created.Id)).Status);
    }

    [Fact]
    public async Task Restored_QR_hold_expires_again_and_cannot_restore_twice()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 2)], "", "hcm-q1"));
        var orders = new OrderService(store, Customer, clock); var admin = new OrderService(store, Owner, clock);
        var created = await orders.CreateAsync(CommerceTests.Checkout(quote, "qr"));
        clock.Advance(TimeSpan.FromMinutes(31)); await admin.ExpireAsync();
        var expired = await orders.GetAsync(created.Id);
        var restored = await admin.ChangeStatusAsync(created.Id, new("Chờ xác nhận", expired.Version));
        Assert.NotNull(restored.ReservationExpiresAt); Assert.Equal("Chờ xác minh thanh toán", restored.PaymentStatus);
        Assert.Equal("version-conflict", (await Assert.ThrowsAsync<CommerceException>(() => admin.ChangeStatusAsync(created.Id, new("Chờ xác nhận", expired.Version)))).Code);
        clock.Advance(TimeSpan.FromMinutes(31)); Assert.Equal(1, await admin.ExpireAsync());
        Assert.Equal(20, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Guest_can_create_gateway_session_only_with_payment_reference()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock(); var guest = new CatalogTests.Actor("", "");
        var quote = await new ShoppingService(store, guest, clock).QuoteAsync(new([new("bouquet-rose", 1)], "", "hcm-q1"));
        var created = await new OrderService(store, guest, clock).CreateAsync(CommerceTests.Checkout(quote, "vnpay"));
        var service = new PaymentService(store, guest, new SimulatedPaymentGateway(), clock);
        Assert.Equal(404, (await Assert.ThrowsAsync<CommerceException>(() => service.CreateAttemptAsync(created.Id))).Status);
        Assert.Equal("pending", (await service.CreateAttemptAsync(created.Id, paymentReference: created.PaymentReference)).Status);
    }

    [Fact]
    public async Task Repository_does_not_leak_mutable_collections_across_transaction_boundaries()
    {
        using var store = new InMemoryUnitOfWork(); var data = new[] { "one" };
        await store.ExecuteAsync(async (session, ct) =>
        { await session.Repository<WrappingSettings>().PutAsync(new("test", [new(50, 10000)]), ct);
            await session.Repository<Promotion>().PutAsync(new("isolated", "Test", 10, false, data, true), ct); return true; });
        data[0] = "changed";
        var result = await store.ExecuteAsync((session, ct) => session.Repository<Promotion>().FindAsync("isolated", ct));
        Assert.Equal("one", Assert.Single(result!.ProductIds));
        if (result.ProductIds is IList<string> list) list[0] = "external";
        var reread = await store.ExecuteAsync((session, ct) => session.Repository<Promotion>().FindAsync("isolated", ct));
        Assert.Equal("one", Assert.Single(reread!.ProductIds));
    }

    [Fact]
    public async Task Service_validation_rejects_invalid_record_parameters_without_MVC()
    {
        using var store = new InMemoryUnitOfWork();
        await Assert.ThrowsAsync<CommerceException>(() => new CatalogService(store, Owner, TimeProvider.System).SaveProductAsync(null,
            new("Hoa", "Mô tả", "/images/rose.webp", [], null, 999, 1)));
    }

    [Fact]
    public async Task Lookup_limit_counts_failed_lookups_and_provides_retry_after()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var orders = new OrderService(store, Customer, clock);
        for (var attempt = 0; attempt < 20; attempt++)
            Assert.Equal(404, (await Assert.ThrowsAsync<CommerceException>(() => orders.TrackAsync(new("missing", "0901234567")))).Status);
        var limited = await Assert.ThrowsAsync<CommerceException>(() => orders.TrackAsync(new("missing", "0901234567")));
        Assert.Equal(429, limited.Status); Assert.Equal(600, limited.RetryAfter);
        clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(404, (await Assert.ThrowsAsync<CommerceException>(() => orders.TrackAsync(new("missing", "0901234567")))).Status);
    }

    [Fact]
    public async Task Sold_count_is_updated_once_and_returned_goods_reverse_it_once()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 2)], "", "hcm-q1"));
        var orders = new OrderService(store, Owner, clock);
        var created = await new OrderService(store, Customer, clock).CreateAsync(CommerceTests.Checkout(quote));
        var order = await orders.ChangeStatusAsync(created.Id, new("Đang chuẩn bị", 1));
        order = await orders.ChangeStatusAsync(created.Id, new("Đang giao", order.Version, "Quận 1", "Ngày mai"));
        order = await orders.ChangeStatusAsync(created.Id, new("Đã giao", order.Version));
        order = await orders.ChangeStatusAsync(created.Id, new("Đã giao", order.Version));
        var catalog = new CatalogService(store, Owner, clock);
        Assert.Equal(2, (await catalog.ProductAsync("bouquet-rose")).SoldCount);
        order = await orders.ChangeStatusAsync(created.Id, new("Đã hủy", order.Version, RestockSold: true));
        Assert.Equal(0, (await catalog.ProductAsync("bouquet-rose")).SoldCount);
        await orders.ChangeStatusAsync(created.Id, new("Đã hủy", order.Version, RestockSold: true));
        Assert.Equal(20, (await catalog.ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Failed_callback_for_an_older_attempt_does_not_overwrite_current_payment_state()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new CommerceTests.Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", 1)], "", "hcm-q1"));
        var orders = new OrderService(store, Customer, clock);
        var order = await orders.CreateAsync(CommerceTests.Checkout(quote, "vnpay"));
        var payments = new PaymentService(store, Customer, new SimulatedPaymentGateway(), clock);
        var old = await payments.CreateAttemptAsync(order.Id);
        clock.Advance(TimeSpan.FromMinutes(16));
        var current = await payments.RetryAsync(old.Id);
        await new PaymentService(store, Owner, new SimulatedPaymentGateway(), clock).SimulateAsync(old.Id, new("failed", quote.Totals.Total, "OLD-FAILED"));
        var result = await orders.GetAsync(order.Id);
        Assert.Equal(current.Id, result.CurrentPaymentId); Assert.Equal("chua_thanh_toan", result.PaymentStatus);
        Assert.Equal("reserved", result.InventoryState);
    }
}
