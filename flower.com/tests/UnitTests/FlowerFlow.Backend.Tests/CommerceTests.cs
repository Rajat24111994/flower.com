using System.Text.Json;
using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using FlowerFlow.InMemory;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Unit")]
public sealed class CommerceTests
{
    internal sealed class Clock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 16, 1, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan duration) => _now += duration;
    }
    private static readonly CatalogTests.Actor Customer = new("customer-a", "customer");
    private static readonly CatalogTests.Actor Owner = new();
    internal static CheckoutRequest Checkout(QuoteResponse quote, string method = "cod", string? key = null) => new(
        quote.Items.Select(item => new CartLine(item.Id, item.Quantity, item.ProductId, item.Size, item.Color,
            item.CardMessage, item.PersonalNote, item.CustomBouquetId)).ToArray(), "Nguyễn An", "0901234567", "Địa chỉ giả lập",
        "2026-11-17", "08:00–11:00", "hcm-q1", method, key ?? Guid.NewGuid().ToString(), quote.Totals);
    private static Task<QuoteResponse> Quote(InMemoryUnitOfWork store, Clock clock, int quantity = 1) =>
        new ShoppingService(store, Customer, clock).QuoteAsync(new([new("bouquet-rose", quantity)], "", "hcm-q1"));

    [Fact]
    public async Task Quote_preserves_promotion_wrapping_and_shipping_rules()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock();
        var quote = await new ShoppingService(store, Customer, clock).QuoteAsync(new([
            new("line-a", 3, "stem-rose", CustomBouquetId: "bouquet-a"), new("line-b", 2, "stem-rose", CustomBouquetId: "bouquet-a")], "demo10", "hcm-q1"));
        Assert.Equal(new MoneyTotals(125000, 12500, 0, 20000, 30000, 162500), quote.Totals);
        Assert.Equal(5, Assert.Single(quote.CustomBouquets).StemCount);
        Assert.Equal(100, (await new CatalogService(store, Owner, clock).ProductAsync("stem-rose")).Quantity);
    }

    [Fact]
    public async Task Quote_aggregates_stock_across_distinct_lines_and_enforces_flower_bouquets()
    {
        using var store = new InMemoryUnitOfWork(); var service = new ShoppingService(store, Customer, new Clock());
        Assert.Equal("insufficient-stock", (await Assert.ThrowsAsync<CommerceException>(() => service.QuoteAsync(new([
            new("a", 12, "bouquet-rose"), new("b", 12, "bouquet-rose")])))).Code);
        Assert.Equal("invalid-custom-bouquet", (await Assert.ThrowsAsync<CommerceException>(() => service.QuoteAsync(new([new("stem-rose", 1)])))).Code);
    }

    [Fact]
    public async Task Cart_is_scoped_to_customer_and_rejects_stale_versions()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock();
        var first = new ShoppingService(store, Customer, clock);
        await first.SaveCartAsync(new([new("bouquet-rose", 2)], 0));
        Assert.Empty((await new ShoppingService(store, new CatalogTests.Actor("customer-b", "customer"), clock).CartAsync()).Items);
        Assert.Equal("version-conflict", (await Assert.ThrowsAsync<CommerceException>(() => first.SaveCartAsync(new([], 0)))).Code);
        Assert.Single((await first.CartAsync()).Items);
    }

    [Fact]
    public async Task Concurrent_idempotent_checkouts_create_one_order_and_reserve_once()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var service = new OrderService(store, Customer, clock);
        var request = Checkout(await Quote(store, clock, 3));
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(() => service.CreateAsync(request))));
        Assert.Single(results.Select(item => item.Id).Distinct());
        Assert.Single(await service.ListAsync());
        Assert.Equal(17, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
        Assert.Equal("idempotency-conflict", (await Assert.ThrowsAsync<CommerceException>(() => service.CreateAsync(request with { OrderNote = "khác" }))).Code);
    }

    [Fact]
    public async Task Concurrent_different_checkouts_do_not_oversell()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var service = new OrderService(store, Customer, clock);
        var quote = await Quote(store, clock, 15);
        async Task<bool> Attempt()
        {
            try { await service.CreateAsync(Checkout(quote)); return true; }
            catch (CommerceException exception) when (exception.Code == "insufficient-stock") { return false; }
        }
        Assert.Single(await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(Attempt))), outcome => outcome);
        Assert.Equal(5, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Changed_price_is_rejected_without_inventory_or_order_writes()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var service = new OrderService(store, Customer, clock);
        var request = Checkout(await Quote(store, clock));
        Assert.Equal("price-changed", (await Assert.ThrowsAsync<CommerceException>(() => service.CreateAsync(request with
        { ExpectedTotals = request.ExpectedTotals with { Total = 1 } }))).Code);
        Assert.Empty(await service.ListAsync());
        Assert.Equal(20, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Expiration_restores_once_and_confirmed_orders_do_not_expire()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var customer = new OrderService(store, Customer, clock);
        var admin = new OrderService(store, Owner, clock);
        var first = await customer.CreateAsync(Checkout(await Quote(store, clock, 2)));
        var second = await customer.CreateAsync(Checkout(await Quote(store, clock, 3)));
        await admin.ChangeStatusAsync(second.Id, new("Đang chuẩn bị", 1));
        clock.Advance(TimeSpan.FromMinutes(31));
        Assert.Equal(1, await admin.ExpireAsync()); Assert.Equal(0, await admin.ExpireAsync());
        Assert.Equal("Đã hủy", (await customer.GetAsync(first.Id)).Status);
        Assert.Equal("Đang chuẩn bị", (await customer.GetAsync(second.Id)).Status);
        Assert.Equal(17, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Guest_limit_and_ownership_are_enforced()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock();
        var guest = new OrderService(store, new CatalogTests.Actor("", ""), clock);
        var guestRequest = Checkout(await Quote(store, clock, 6));
        Assert.Equal("guest-quantity-limit", (await Assert.ThrowsAsync<CommerceException>(() => guest.CreateAsync(guestRequest))).Code);
        var created = await new OrderService(store, Customer, clock).CreateAsync(Checkout(await Quote(store, clock)));
        Assert.Equal(404, (await Assert.ThrowsAsync<CommerceException>(() => new OrderService(store,
            new CatalogTests.Actor("customer-b", "customer"), clock).GetAsync(created.Id))).Status);
        var tracking = await guest.TrackAsync(new(created.Id, "0901234567"));
        Assert.All(tracking.History, item => Assert.Equal("", item.Location));
    }

    [Fact]
    public async Task Qr_reconciliation_and_refund_are_exact_audited_and_do_not_restore_stock()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock();
        var orders = new OrderService(store, Customer, clock);
        var created = await orders.CreateAsync(Checkout(await Quote(store, clock, 2), "qr"));
        var payments = new PaymentService(store, Owner, new SimulatedPaymentGateway(), clock);
        Assert.Equal("payment-amount-mismatch", (await Assert.ThrowsAsync<CommerceException>(() => payments.ReconcileQrAsync(created.Id, new(1, "BANK-1")))).Code);
        await payments.ReconcileQrAsync(created.Id, new(created.Totals.Total, "BANK-1"));
        await payments.RefundAsync(created.Id, new("REFUND-1"));
        Assert.Equal("payment-already-refunded", (await Assert.ThrowsAsync<CommerceException>(() => payments.RefundAsync(created.Id, new("REFUND-2")))).Code);
        Assert.Equal(2, (await payments.HistoryAsync(created.Id)).Count);
        Assert.Equal(18, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
    }

    [Fact]
    public async Task Simulated_gateway_duplicate_results_are_idempotent_and_late_money_does_not_restore_stock()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock();
        var orders = new OrderService(store, Customer, clock);
        var created = await orders.CreateAsync(Checkout(await Quote(store, clock, 2), "vnpay"));
        var customerPayments = new PaymentService(store, Customer, new SimulatedPaymentGateway(), clock);
        var attempt = await customerPayments.CreateAttemptAsync(created.Id);
        var ownerPayments = new PaymentService(store, Owner, new SimulatedPaymentGateway(), clock);
        clock.Advance(TimeSpan.FromMinutes(16));
        var outcome = new SimulatePaymentRequest("paid", created.Totals.Total, "PROVIDER-1");
        await ownerPayments.SimulateAsync(attempt.Id, outcome); await ownerPayments.SimulateAsync(attempt.Id, outcome);
        var order = await orders.GetAsync(created.Id);
        Assert.True(order.PaymentVerified); Assert.Equal("Đã hủy", order.Status);
        Assert.Equal("released", order.InventoryState);
        Assert.Equal(20, (await new CatalogService(store, Owner, clock).ProductAsync("bouquet-rose")).Quantity);
        Assert.Single(await ownerPayments.HistoryAsync(created.Id));
    }

    [Fact]
    public async Task Delivered_order_has_one_review_and_requires_moderation_before_public_listing()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var customerOrders = new OrderService(store, Customer, clock);
        var created = await customerOrders.CreateAsync(Checkout(await Quote(store, clock)));
        var reviews = new ReviewService(store, Customer, clock); var request = new ReviewRequest(created.Id, 5, "Hoa đẹp", []);
        Assert.Equal("order-not-delivered", (await Assert.ThrowsAsync<CommerceException>(() => reviews.CreateAsync(request))).Code);
        var adminOrders = new OrderService(store, Owner, clock);
        await adminOrders.ChangeStatusAsync(created.Id, new("Đang chuẩn bị", 1));
        await adminOrders.ChangeStatusAsync(created.Id, new("Đang giao", 2, "Quận 1", "Ngày mai"));
        await adminOrders.ChangeStatusAsync(created.Id, new("Đã giao", 3));
        var review = await reviews.CreateAsync(request); Assert.Empty(await reviews.ListAsync());
        Assert.Equal("already-reviewed", (await Assert.ThrowsAsync<CommerceException>(() => reviews.CreateAsync(request))).Code);
        await new ReviewService(store, Owner, clock).ModerateAsync(review.Id, new("approved", 1));
        Assert.Single(await reviews.ListAsync());
    }

    [Fact]
    public async Task Design_checks_stems_without_reserving_and_token_protects_customer_response()
    {
        using var store = new InMemoryUnitOfWork(); var clock = new Clock(); var guest = new CatalogTests.Actor("", "");
        var service = new DesignService(store, guest, clock);
        var design = await service.CreateAsync(new("Nguyễn An", "0901234567", "Địa chỉ giả lập", "2026-11-17", "08:00–11:00", "hcm-q1",
            new(), [new("stem-rose", 5, "đỏ")]));
        Assert.Equal(145000, design.Request.EstimatedTotal);
        Assert.Equal(100, (await new CatalogService(store, Owner, clock).ProductAsync("stem-rose")).Quantity);
        Assert.Equal(404, (await Assert.ThrowsAsync<CommerceException>(() => service.GetAsync(design.Request.Id, new string('x', 64)))).Status);
        Assert.DoesNotContain("accessTokenHash", JsonSerializer.Serialize(design.Request, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        var updated = await new DesignService(store, Owner, clock).UpdateAsync(design.Request.Id, new("Chờ khách xác nhận", 1, 160000));
        var result = await service.RespondAsync(updated.Id, new("accept", updated.Version), design.AccessToken);
        Assert.Equal("Đang thực hiện", result.Status);
        Assert.Equal("version-conflict", (await Assert.ThrowsAsync<CommerceException>(() => service.RespondAsync(updated.Id, new("accept", updated.Version), design.AccessToken))).Code);
    }
}
