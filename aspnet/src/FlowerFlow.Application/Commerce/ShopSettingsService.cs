using FlowerFlow.Application.Catalog;
using FlowerFlow.Application.Orders;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Application.Commerce;

public sealed class ShopSettingsService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public Task<IReadOnlyList<DeliveryZone>> ZonesAsync(CancellationToken ct = default) =>
        work.ExecuteAsync((session, token) => session.Repository<DeliveryZone>().ListAsync(token), ct);
    public Task<IReadOnlyList<Promotion>> PromotionsAsync(CancellationToken ct = default) =>
        work.ExecuteAsync((session, token) => session.Repository<Promotion>().ListAsync(token), ct);
    public Task<WrappingSettings?> WrappingAsync(CancellationToken ct = default) =>
        work.ExecuteAsync((session, token) => session.Repository<WrappingSettings>().FindAsync("default", token), ct);

    public Task<DeliveryZone> SaveZoneAsync(string id, DeliveryZoneRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor); InputValidation.Validate(request);
        if (!ValidSettingId(id)) throw new CommerceException(400, "invalid-id", "Mã khu vực không hợp lệ.");
        return Save(new DeliveryZone(id, request.Province.Trim(), request.District.Trim(), request.Fee, request.Enabled), "delivery-zone.save", ct);
    }
    public Task<Promotion> SavePromotionAsync(string id, PromotionRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        if (!ValidSettingId(id) || request.ProductIds.Any(value => !ProductRules.ValidId(value))
            || !string.IsNullOrEmpty(request.StartDate) && !OrderValidation.IsValidDate(request.StartDate)
            || !string.IsNullOrEmpty(request.EndDate) && !OrderValidation.IsValidDate(request.EndDate)
            || !string.IsNullOrEmpty(request.StartDate) && !string.IsNullOrEmpty(request.EndDate) && string.CompareOrdinal(request.StartDate, request.EndDate) > 0)
            throw new CommerceException(400, "invalid-promotion", "Thông tin ưu đãi không hợp lệ.");
        return Save(new Promotion(id, request.Title.Trim(), request.DiscountPercent, request.AllProducts,
            request.ProductIds.Distinct().ToArray(), request.Active, request.StartDate, request.EndDate), "promotion.save", ct);
    }
    public Task<WrappingSettings> SaveWrappingAsync(WrappingRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor); InputValidation.Validate(request);
        if (BouquetWrapping.NormalizeTiers(ShoppingService.Json(request.Tiers)) is null)
            throw new CommerceException(400, "invalid-wrapping-tiers", "Bậc phí phải tăng dần và kết thúc ở 50 cành.");
        return Save(new WrappingSettings("default", request.Tiers.ToArray()), "wrapping.save", ct);
    }
    private Task<T> Save<T>(T entity, string action, CancellationToken ct) where T : class, IEntity => work.ExecuteAsync(async (session, token) =>
    {
        await session.Repository<T>().PutAsync(entity, token);
        await session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId, action, entity.Id, time.GetUtcNow()), token);
        return entity;
    }, ct);
    private static bool ValidSettingId(string id) => System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,80}$");
}
