using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FlowerFlow.Domain.Rules;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed record CreateDesignRequest([Required, StringLength(100)] string CustomerName, [Required, StringLength(30)] string Phone,
    [Required, StringLength(500)] string Address, [Required] string DeliveryDate, [Required] string DeliveryTime,
    [Required] string DeliveryZoneId, [Required] DesignPreferences Design, [Required, MaxLength(20)] DesignStem[] Stems,
    [StringLength(500)] string DeliveryNote = "", [StringLength(360000)] string ReferenceImage = "");
public sealed record DesignUpdateRequest([Required] string Status, [Range(1, long.MaxValue)] long ExpectedVersion,
    [Range(0, 1_000_000_000)] long? QuotedTotal = null, [StringLength(1000)] string QuoteNote = "");
public sealed record DesignRespondRequest([Required, RegularExpression("^(accept|reject)$")] string Response,
    [Range(1, long.MaxValue)] long ExpectedVersion);
public sealed record DesignResponse(string Id, string CustomerName, string Phone, string Address,
    string DeliveryDate, string DeliveryTime, string DeliveryZoneId, string DeliveryNote, DesignPreferences Design,
    IReadOnlyList<PricedStem> Stems, string ReferenceImage, long Subtotal, long WrappingFee, long EstimatedTotal,
    long QuotedTotal, string QuoteNote, string Status, string CustomerResponse, IReadOnlyList<DesignHistory> History,
    DateTimeOffset CreatedAt, long Version);
public sealed record CreatedDesign(DesignResponse Request, string AccessToken);

public sealed class DesignService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public Task<CreatedDesign> CreateAsync(CreateDesignRequest request, CancellationToken ct = default)
    {
        InputValidation.Validate(request);
        var preferences = DesignInputRules.ParseDesign(ShoppingService.Json(request.Design));
        var stems = DesignInputRules.NormalizeStems(ShoppingService.Json(request.Stems));
        var image = DesignInputRules.ValidImage(ShoppingService.Json(request.ReferenceImage));
        if (preferences is null || stems is null || image is null || stems.Count == 0 && !(request.Design.Surprise && request.Design.Budget > 0)
            || OrderValidationService.NormalizePhone(request.Phone).Length is < 8 or > 15)
            throw new CommerceException(400, "invalid-design-request", "Thông tin thiết kế không hợp lệ.");
        var scheduleError = OrderValidationService.DeliveryScheduleError(request.DeliveryDate, request.DeliveryTime, time.GetUtcNow());
        if (scheduleError.Length > 0) throw new CommerceException(400, "invalid-delivery-schedule", scheduleError);
        var normalized = JsonSerializer.Deserialize<DesignPreferences>(ShoppingService.Json(preferences), ShoppingService.JsonOptions)!;
        return work.ExecuteAsync(async (session, token) =>
        {
            var zone = await session.Repository<DeliveryZone>().FindAsync(request.DeliveryZoneId, token);
            if (zone is null || !zone.Enabled) throw CommerceException.Conflict("delivery-zone-unavailable", "Khu vực giao không khả dụng.");
            var priced = new List<PricedStem>();
            foreach (var stem in stems)
            {
                var product = await session.Repository<Product>().FindAsync((string)stem["productId"], token);
                if (product is null || product.Status == "hidden" || product.SaleType != "flower")
                    throw CommerceException.Conflict("product-unavailable", "Loại hoa không khả dụng.");
                var color = (string)stem["color"]; var quantity = Convert.ToInt32(stem["quantity"]);
                if (product.Colors.Count > 0 && !product.Colors.Any(value => DesignInputRules.CanonicalColor(ShoppingService.Json(value)) == DesignInputRules.CanonicalColor(ShoppingService.Json(color))))
                    throw CommerceException.Conflict("product-unavailable", "Màu hoa không khả dụng.");
                if (product.Quantity < quantity) throw CommerceException.Conflict("insufficient-stock", "Không đủ số cành hoa.");
                priced.Add(new(product.Id, quantity, color, (string)stem["role"], product.Title, product.Price));
            }
            var wrapping = await session.Repository<WrappingSettings>().FindAsync("default", token);
            if (BouquetWrapping.NormalizeTiers(ShoppingService.Json(wrapping?.Tiers ?? [])) is null)
                throw CommerceException.Conflict("bouquet-wrapping-unavailable", "Chưa cấu hình phí gói bó.");
            var stemCount = priced.Sum(item => item.Quantity);
            var fee = stemCount == 0 ? 0 : BouquetWrapping.FeeForDesign(ShoppingService.Json(wrapping!.Tiers), stemCount, ShoppingService.Json(normalized)) ?? 0;
            var subtotal = priced.Sum(item => (decimal)item.Price * item.Quantity);
            if (subtotal + fee > ProductRules.MaxSafeInteger) throw new CommerceException(400, "invalid-total", "Tổng tiền vượt giới hạn.");
            var mainId = priced.Any(item => item.ProductId == normalized.MainProductId) ? normalized.MainProductId : priced.FirstOrDefault()?.ProductId ?? "";
            var accessToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)); var now = time.GetUtcNow();
            var design = new FlowerDesign(Guid.NewGuid().ToString("N"), actor.UserId, OrderService.Hash(accessToken), request.CustomerName.Trim(), request.Phone.Trim(),
                request.Address.Trim(), request.DeliveryDate, request.DeliveryTime, zone.Id, request.DeliveryNote?.Trim() ?? "",
                normalized with { MainProductId = mainId }, priced.ToArray(), image, (long)subtotal, fee, (long)subtotal + fee,
                0, "", "Chờ tư vấn", "", [new("Chờ tư vấn", "Khách đã gửi yêu cầu thiết kế.", now)], now);
            // A design consultation checks availability but does not reserve inventory.
            await session.Repository<FlowerDesign>().PutAsync(design, token);
            return new CreatedDesign(Response(design), accessToken);
        }, ct);
    }

    public Task<DesignResponse> GetAsync(string id, string? accessToken = null, CancellationToken ct = default) => work.ExecuteAsync(async (session, token) =>
    {
        var design = await session.Repository<FlowerDesign>().FindAsync(id, token) ?? throw CommerceException.Missing("yêu cầu thiết kế");
        Authorize(design, accessToken); return Response(design);
    }, ct);
    public Task<IReadOnlyList<DesignResponse>> ListAsync(bool manage = false, CancellationToken ct = default)
    {
        if (manage) CommerceAccess.Admin(actor); else CommerceAccess.Customer(actor);
        return work.ExecuteAsync<IReadOnlyList<DesignResponse>>(async (session, token) => (await session.Repository<FlowerDesign>().ListAsync(token))
            .Where(item => manage || item.UserId == actor.UserId).OrderByDescending(item => item.CreatedAt).Take(100).Select(Response).ToArray(), ct);
    }
    public Task<DesignResponse> UpdateAsync(string id, DesignUpdateRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        if (!DesignInputRules.Statuses.Contains(request.Status) || request.Status == "Chờ khách xác nhận" && request.QuotedTotal is null)
            throw new CommerceException(400, "invalid-design-update", "Trạng thái hoặc báo giá không hợp lệ.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<FlowerDesign>(); var design = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("yêu cầu thiết kế");
            CheckVersion(design, request.ExpectedVersion);
            var updated = design with { Status = request.Status, QuotedTotal = request.QuotedTotal ?? design.QuotedTotal,
                QuoteNote = request.QuoteNote ?? "", Version = design.Version + 1,
                History = design.History.Append(new(request.Status, request.QuoteNote ?? "", time.GetUtcNow())).ToArray() };
            await repository.PutAsync(updated, token);
            await session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId, "design.update", id, time.GetUtcNow()), token);
            return Response(updated);
        }, ct);
    }
    public Task<DesignResponse> RespondAsync(string id, DesignRespondRequest request, string? accessToken = null, CancellationToken ct = default)
    {
        InputValidation.Validate(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<FlowerDesign>(); var design = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("yêu cầu thiết kế");
            // An admin may manage the quote, but cannot accept on behalf of a different customer without its access token.
            if (!(actor.UserId.Length > 0 && design.UserId == actor.UserId) && !ValidToken(accessToken, design.AccessTokenHash))
                throw CommerceException.Missing("yêu cầu thiết kế");
            CheckVersion(design, request.ExpectedVersion);
            if (design.Status != "Chờ khách xác nhận") throw CommerceException.Conflict("design-quote-unavailable", "Yêu cầu chưa có báo giá cần xác nhận.");
            var status = request.Response == "accept" ? "Đang thực hiện" : "Đã hủy";
            var updated = design with { Status = status, CustomerResponse = request.Response, Version = design.Version + 1,
                History = design.History.Append(new(status, request.Response == "accept" ? "Khách chấp nhận báo giá." : "Khách từ chối báo giá.", time.GetUtcNow())).ToArray() };
            await repository.PutAsync(updated, token); return Response(updated);
        }, ct);
    }
    private void Authorize(FlowerDesign design, string? token)
    {
        if (actor.Role is "owner" or "admin" || actor.UserId.Length > 0 && actor.UserId == design.UserId || ValidToken(token, design.AccessTokenHash)) return;
        throw CommerceException.Missing("yêu cầu thiết kế");
    }
    private static bool ValidToken(string? token, string hash) => token?.Length is >= 32 and <= 100
        && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(token)), Convert.FromHexString(hash));
    private static void CheckVersion(FlowerDesign design, long version)
    { if (design.Version != version) throw CommerceException.Conflict("version-conflict", "Yêu cầu thiết kế đã thay đổi."); }
    private static DesignResponse Response(FlowerDesign item) => new(item.Id, item.CustomerName, item.Phone, item.Address,
        item.DeliveryDate, item.DeliveryTime, item.DeliveryZoneId, item.DeliveryNote,
        item.Design with { Addons = item.Design.Addons?.ToArray(), DislikedFlowers = item.Design.DislikedFlowers?.ToArray(), ExcludedFlowers = item.Design.ExcludedFlowers?.ToArray() },
        item.Stems.ToArray(), item.ReferenceImage, item.Subtotal, item.WrappingFee, item.EstimatedTotal, item.QuotedTotal,
        item.QuoteNote, item.Status, item.CustomerResponse, item.History.ToArray(), item.CreatedAt, item.Version);
}
