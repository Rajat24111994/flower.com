using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using FlowerFlow.InMemory;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Unit")]
public sealed class CatalogTests
{
    internal sealed record Actor(string UserId = "owner", string Role = "owner") : ICurrentActor;
    private static CatalogService Service(InMemoryUnitOfWork store, string role = "owner") => new(store, new Actor(Role: role), TimeProvider.System);

    [Fact]
    public async Task Category_rename_changes_display_name_and_delete_uncategorizes_products()
    {
        using var store = new InMemoryUnitOfWork(); var service = Service(store);
        await service.SaveCategoryAsync("love", new("Tên mới"));
        Assert.Equal("Tên mới", (await service.ProductAsync("stem-rose")).Category);
        await service.DeleteCategoryAsync("love");
        var product = await service.ProductAsync("stem-rose");
        Assert.Null(product.CategoryId); Assert.Equal("", product.Category);
        Assert.Equal(2, product.Version);
    }

    [Fact]
    public async Task Category_duplicates_use_Vietnamese_case_insensitive_comparison()
    {
        using var store = new InMemoryUnitOfWork(); var service = Service(store);
        var error = await Assert.ThrowsAsync<CommerceException>(() => service.SaveCategoryAsync(null, new(" HOA TÌNH YÊU ")));
        Assert.Equal("category-exists", error.Code);
    }

    [Fact]
    public async Task Admin_cannot_change_flower_price_and_owner_change_is_audited()
    {
        using var store = new InMemoryUnitOfWork();
        Assert.Equal(403, (await Assert.ThrowsAsync<CommerceException>(() => Service(store, "admin")
            .ChangeFlowerPriceAsync("stem-rose", new(30000, 1)))).Status);
        var owner = Service(store); var change = await owner.ChangeFlowerPriceAsync("stem-rose", new(30000, 1));
        Assert.Equal(25000, change.OldPrice); Assert.Equal(30000, (await owner.ProductAsync("stem-rose")).Price);
        Assert.Single(await owner.PriceHistoryAsync("stem-rose"));
        Assert.Single(await store.ExecuteAsync((session, ct) => session.Repository<AuditEntry>().ListAsync(ct)));
    }

    [Fact]
    public async Task Concurrent_inventory_updates_cannot_overwrite_each_other()
    {
        using var store = new InMemoryUnitOfWork(); var service = Service(store);
        async Task<bool> Attempt()
        {
            try { await service.AdjustInventoryAsync("bouquet-rose", new(-15, "Xuất kho", 1)); return true; }
            catch (CommerceException exception) when (exception.Code == "version-conflict") { return false; }
        }
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(Attempt)));
        Assert.Single(outcomes, success => success);
        Assert.Equal(5, (await service.ProductAsync("bouquet-rose")).Quantity);
        Assert.Single(await service.InventoryHistoryAsync("bouquet-rose"));
    }

    [Fact]
    public async Task Failure_and_cancellation_roll_back_all_writes()
    {
        using var store = new InMemoryUnitOfWork();
        await Assert.ThrowsAsync<InvalidOperationException>(() => store.ExecuteAsync<bool>(async (session, ct) =>
        {
            await session.Repository<Category>().PutAsync(new("temporary", "Temporary"), ct);
            throw new InvalidOperationException("Simulated failure after write");
        }));
        using var cancellation = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.ExecuteAsync(async (session, ct) =>
        {
            await session.Repository<Category>().PutAsync(new("cancelled", "Cancelled"), ct);
            cancellation.Cancel(); return true;
        }, cancellation.Token));
        var categories = await Service(store).CategoriesAsync();
        Assert.DoesNotContain(categories, category => category.Id is "temporary" or "cancelled");
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/png;base64,AAAA")]
    public async Task Product_rejects_unsafe_images(string image)
    {
        using var store = new InMemoryUnitOfWork();
        await Assert.ThrowsAsync<CommerceException>(() => Service(store).SaveProductAsync(null,
            new("Hoa", "Mô tả", image, [], null, 450000, 5)));
    }
}
