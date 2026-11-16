using System.Globalization;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed class CatalogService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public Task<IReadOnlyList<Category>> CategoriesAsync(CancellationToken ct = default) => work.ExecuteAsync(
        (session, token) => session.Repository<Category>().ListAsync(token), ct);

    public Task<Category> SaveCategoryAsync(string? id, CategoryRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Category>();
            if (id is not null && await repository.FindAsync(id, token) is null) throw CommerceException.Missing("danh mục");
            var name = request.Name.Trim();
            var comparer = StringComparer.Create(CultureInfo.GetCultureInfo("vi-VN"), true);
            if ((await repository.ListAsync(token)).Any(item => item.Id != id && comparer.Equals(item.Name, name)))
                throw CommerceException.Conflict("category-exists", "Danh mục đã tồn tại.");
            var category = new Category(id ?? Guid.NewGuid().ToString("N"), name);
            await repository.PutAsync(category, token);
            await Audit(session, "category.save", category.Id, token);
            return category;
        }, ct);
    }

    public Task<bool> DeleteCategoryAsync(string id, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        return work.ExecuteAsync(async (session, token) =>
        {
            if (await session.Repository<Category>().FindAsync(id, token) is null) throw CommerceException.Missing("danh mục");
            foreach (var product in (await session.Repository<Product>().ListAsync(token)).Where(item => item.CategoryId == id))
                await session.Repository<Product>().PutAsync(product with { CategoryId = null, Version = product.Version + 1 }, token);
            await session.Repository<Category>().RemoveAsync(id, token);
            await Audit(session, "category.delete", id, token);
            return true;
        }, ct);
    }

    public Task<Page<ProductResponse>> ProductsAsync(string? search = null, string? categoryId = null,
        int page = 1, int pageSize = 20, bool manage = false, CancellationToken ct = default)
    {
        if (manage) CommerceAccess.Admin(actor);
        if (page < 1 || pageSize is < 1 or > 100 || search?.Length > 120)
            throw new CommerceException(400, "invalid-argument", "Phân trang hoặc từ khóa không hợp lệ.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var categories = (await session.Repository<Category>().ListAsync(token)).ToDictionary(item => item.Id, item => item.Name);
            var products = (await session.Repository<Product>().ListAsync(token))
                .Where(item => manage || item.Status != "hidden")
                .Where(item => categoryId is null || item.CategoryId == categoryId)
                .Where(item => string.IsNullOrWhiteSpace(search) || (item.Title + " " + item.Description)
                    .Contains(search.Trim(), StringComparison.CurrentCultureIgnoreCase))
                .OrderBy(item => item.Id, StringComparer.Ordinal).ToArray();
            return new Page<ProductResponse>(products.Skip((int)Math.Min((long)(page - 1) * pageSize, int.MaxValue))
                .Take(pageSize).Select(item => Response(item, categories)).ToArray(), products.Length, page, pageSize);
        }, ct);
    }

    public Task<ProductResponse> ProductAsync(string id, bool manage = false, CancellationToken ct = default)
    {
        if (manage) CommerceAccess.Admin(actor);
        return work.ExecuteAsync(async (session, token) =>
        {
            var item = await session.Repository<Product>().FindAsync(id, token) ?? throw CommerceException.Missing("sản phẩm");
            if (!manage && item.Status == "hidden") throw CommerceException.Missing("sản phẩm");
            var categories = (await session.Repository<Category>().ListAsync(token)).ToDictionary(category => category.Id, category => category.Name);
            return Response(item, categories);
        }, ct);
    }

    public Task<ProductResponse> SaveProductAsync(string? id, ProductRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); ValidateProduct(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Product>();
            var old = id is null ? null : await repository.FindAsync(id, token) ?? throw CommerceException.Missing("sản phẩm");
            if (old is not null)
            {
                CheckVersion(old, request.ExpectedVersion);
                if (old.Quantity != request.Quantity) throw CommerceException.Conflict("use-inventory-api", "Đổi tồn kho qua API kho để lưu lịch sử.");
                if (old.SaleType == "flower" && (request.Price != old.Price || request.SaleType != old.SaleType))
                    throw CommerceException.Conflict("use-flower-price-api", "Đổi giá cành hoa qua API giá dành cho Owner.");
            }
            if (request.CategoryId is not null && await session.Repository<Category>().FindAsync(request.CategoryId, token) is null)
                throw new CommerceException(400, "invalid-category", "Danh mục không tồn tại.");
            var product = new Product(id ?? Guid.NewGuid().ToString("N"), request.Title.Trim(), request.Description.Trim(),
                request.Image.Trim(), request.Images.Select(value => value.Trim()).Distinct().ToArray(), request.CategoryId,
                request.Price, request.Quantity, request.SaleType, request.Status, (request.Meaning ?? "").Trim(),
                Tags(request.Colors), Tags(request.Occasions), (old?.Version ?? 0) + 1, old?.SoldCount ?? 0);
            await repository.PutAsync(product, token);
            await Audit(session, old is null ? "product.create" : "product.update", product.Id, token);
            var categories = (await session.Repository<Category>().ListAsync(token)).ToDictionary(item => item.Id, item => item.Name);
            return Response(product, categories);
        }, ct);
    }

    // Soft deletion preserves order references; public queries exclude hidden products.
    public Task<bool> HideProductAsync(string id, long version, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        return work.ExecuteAsync(async (session, token) =>
        {
            var product = await session.Repository<Product>().FindAsync(id, token) ?? throw CommerceException.Missing("sản phẩm");
            CheckVersion(product, version);
            await session.Repository<Product>().PutAsync(product with { Status = "hidden", Version = product.Version + 1 }, token);
            await Audit(session, "product.hide", id, token); return true;
        }, ct);
    }

    public Task<PriceChange> ChangeFlowerPriceAsync(string id, PriceRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor); InputValidation.Validate(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Product>();
            var product = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("sản phẩm");
            CheckVersion(product, request.ExpectedVersion);
            if (product.SaleType != "flower") throw CommerceException.Conflict("not-a-flower", "Sản phẩm không bán theo cành.");
            if (product.Price == request.Price) throw CommerceException.Conflict("price-unchanged", "Giá không thay đổi.");
            var change = new PriceChange(Guid.NewGuid().ToString("N"), id, product.Price, request.Price, actor.UserId, time.GetUtcNow());
            await repository.PutAsync(product with { Price = request.Price, Version = product.Version + 1 }, token);
            await session.Repository<PriceChange>().PutAsync(change, token);
            await Audit(session, "flower-price.update", id, token); return change;
        }, ct);
    }

    public Task<InventoryChange> AdjustInventoryAsync(string id, InventoryRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        if (request.Delta == 0) throw new CommerceException(400, "invalid-argument", "Số lượng thay đổi phải khác 0.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Product>();
            var product = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("sản phẩm");
            CheckVersion(product, request.ExpectedVersion);
            var quantity = (long)product.Quantity + request.Delta;
            if (quantity is < 0 or > ProductRules.MaxSafeInteger) throw CommerceException.Conflict("insufficient-stock", "Tồn kho không hợp lệ.");
            var change = new InventoryChange(Guid.NewGuid().ToString("N"), id, request.Delta, request.Reason.Trim(), actor.UserId, time.GetUtcNow());
            await repository.PutAsync(product with { Quantity = quantity, Version = product.Version + 1 }, token);
            await session.Repository<InventoryChange>().PutAsync(change, token);
            await Audit(session, "inventory.adjust", id, token); return change;
        }, ct);
    }

    public Task<IReadOnlyList<PriceChange>> PriceHistoryAsync(string id, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor);
        return work.ExecuteAsync<IReadOnlyList<PriceChange>>(async (session, token) =>
            (await session.Repository<PriceChange>().ListAsync(token)).Where(item => item.ProductId == id)
                .OrderByDescending(item => item.CreatedAt).ToArray(), ct);
    }

    public Task<IReadOnlyList<InventoryChange>> InventoryHistoryAsync(string id, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        return work.ExecuteAsync<IReadOnlyList<InventoryChange>>(async (session, token) =>
            (await session.Repository<InventoryChange>().ListAsync(token)).Where(item => item.ProductId == id)
                .OrderByDescending(item => item.CreatedAt).ToArray(), ct);
    }

    private Task Audit(ICommerceSession session, string action, string id, CancellationToken ct) =>
        session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId, action, id, time.GetUtcNow()), ct);
    internal static void CheckVersion(Product product, long? version)
    {
        if (version != product.Version) throw CommerceException.Conflict("version-conflict", "Dữ liệu đã thay đổi. Hãy tải lại trước khi cập nhật.");
    }
    private static string[] Tags(string[]? tags) => (tags ?? []).Select(value => value.Trim()).Where(value => value.Length > 0).Distinct().ToArray();
    private static ProductResponse Response(Product product, IReadOnlyDictionary<string, string> categories) => new(
        product.Id, product.Title, product.Description, product.Image, product.Images.ToArray(), product.CategoryId,
        product.CategoryId is null ? "" : categories.GetValueOrDefault(product.CategoryId, ""), product.Price, product.Quantity,
        product.SaleType, product.Status, product.Meaning, product.Colors.ToArray(), product.Occasions.ToArray(), product.Version, product.SoldCount);
    private static void ValidateProduct(ProductRequest request)
    {
        InputValidation.Validate(request);
        if (!ProductRules.SafeImage(request.Image) || request.Images.Any(value => !ProductRules.SafeImage(value))
            || (request.Colors?.Any(value => value is null) ?? false) || (request.Occasions?.Any(value => value is null) ?? false)
            || string.Join(",", request.Colors ?? []).Length > 200 || string.Join(",", request.Occasions ?? []).Length > 300)
            throw new CommerceException(400, "invalid-argument", "Ảnh hoặc thông tin màu hoa, dịp tặng không hợp lệ.");
    }
}
