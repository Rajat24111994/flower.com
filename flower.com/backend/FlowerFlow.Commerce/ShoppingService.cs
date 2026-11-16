using System.Text.Json;
using FlowerFlow.Domain.Rules;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed class ShoppingService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    internal static JsonElement Json<T>(T value) => JsonSerializer.SerializeToElement(value, JsonOptions);

    public Task<Cart> CartAsync(CancellationToken ct = default)
    {
        CommerceAccess.Customer(actor);
        return work.ExecuteAsync(async (session, token) => Copy(await session.Repository<Cart>().FindAsync(actor.UserId, token)
            ?? new Cart(actor.UserId, [], 0)), ct);
    }

    public Task<Cart> SaveCartAsync(CartRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Customer(actor); InputValidation.Validate(request);
        ValidateLines(request.Items, allowEmpty: true);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Cart>(); var old = await repository.FindAsync(actor.UserId, token);
            if ((old?.Version ?? 0) != request.ExpectedVersion)
                throw CommerceException.Conflict("version-conflict", "Giỏ hàng đã thay đổi.");
            // A cart is a draft. Availability and authoritative prices are checked during quote/checkout.
            var cart = new Cart(actor.UserId, request.Items.ToArray(), (old?.Version ?? 0) + 1);
            await repository.PutAsync(cart, token); return Copy(cart);
        }, ct);
    }

    public async Task<QuoteResponse> QuoteAsync(QuoteRequest request, CancellationToken ct = default)
    {
        await work.ExecuteAsync((session, token) => OrderService.ExpireSessionAsync(session, time.GetUtcNow(), token), ct);
        return await work.ExecuteAsync((session, token) => BuildQuoteAsync(session, request, time.GetUtcNow(), token), ct);
    }

    internal static void ValidateLines(CartLine[] items, bool allowEmpty = false)
    {
        if (items is null || items.Length > 50 || items.Any(item => item is null)
            || (items.Length == 0 ? !allowEmpty : OrderValidationService.ValidateQuote(Json(new { items })) is null))
            throw new CommerceException(400, "invalid-cart", "Các dòng giỏ hàng hoặc tùy chọn bó hoa không hợp lệ.");
    }

    internal static async Task<QuoteResponse> BuildQuoteAsync(ICommerceSession session, QuoteRequest request, DateTimeOffset now, CancellationToken ct)
    {
        InputValidation.Validate(request); ValidateLines(request.Items);
        var normalized = OrderValidationService.ValidateQuote(Json(request))
            ?? throw new CommerceException(400, "invalid-quote", "Yêu cầu báo giá không hợp lệ.");
        // The legacy validator returns canonical values, not just a yes/no result.
        // Use those values for lookups and aggregate demand as well as validation.
        request = new QuoteRequest(NormalizedItems(normalized), (string)normalized["promotionId"], (string)normalized["deliveryZoneId"]);
        var items = new List<Dictionary<string, object>>(); var priced = new List<PricedLine>();
        var demand = request.Items.GroupBy(item => item.ProductId ?? item.Id).ToDictionary(group => group.Key, group => group.Sum(item => item.Quantity));
        foreach (var line in request.Items)
        {
            var id = line.ProductId ?? line.Id;
            var product = await session.Repository<Product>().FindAsync(id, ct);
            if (product is null || product.Status == "hidden") throw CommerceException.Conflict("product-unavailable", "Sản phẩm không còn khả dụng.");
            if (product.Price <= 0 || product.Quantity < demand[id]) throw CommerceException.Conflict("insufficient-stock", $"{product.Title} không đủ tồn kho.");
            // Legacy checkout intentionally uses the stored unit price for every size.
            // Do not add the browser's size multiplier here: it would change existing totals.
            items.Add(new Dictionary<string, object> { ["id"] = line.Id, ["productId"] = id,
                ["quantity"] = line.Quantity, ["price"] = product.Price, ["customBouquetId"] = line.CustomBouquetId ?? "",
                ["data"] = new Dictionary<string, object> { ["saleType"] = product.SaleType } });
            priced.Add(new(line.Id, id, product.Title, product.Image, product.SaleType, line.Quantity, product.Price,
                product.Quantity, line.Size ?? "standard", line.Color ?? "original", (line.CardMessage ?? "").Trim(), (line.PersonalNote ?? "").Trim(), line.CustomBouquetId ?? ""));
        }
        try
        {
            var promotions = await session.Repository<Promotion>().ListAsync(ct);
            var promotion = PricingService.FindPromotion(Json(promotions), request.PromotionId, now);
            var totals = PricingService.PriceCart(items, promotion);
            var wrapping = await session.Repository<WrappingSettings>().FindAsync("default", ct);
            var bouquets = PricingService.CalculateCustomBouquets(items, Json(wrapping?.Tiers ?? []));
            var zones = await session.Repository<DeliveryZone>().ListAsync(ct);
            var (zone, shipping) = PricingService.ResolveDeliveryZone(Json(new { zones }), request.DeliveryZoneId);
            var wrappingFee = bouquets.Sum(item => Convert.ToDouble(item["wrappingFee"]));
            long Money(double value) => double.IsFinite(value) && value >= 0 && value <= ProductRules.MaxSafeInteger && value == Math.Truncate(value)
                ? (long)value : throw new CommerceException(400, "invalid-total", "Tổng tiền vượt giới hạn an toàn.");
            var subtotal = Convert.ToDouble(totals["subtotal"]); var savings = Convert.ToDouble(totals["savings"]);
            return new(new(Money(subtotal), Money(savings), 0, Money(wrappingFee), Money(shipping), Money(subtotal - savings + wrappingFee + shipping)),
                priced.ToArray(), bouquets.Select(item => new BouquetFee((string)item["id"], Convert.ToInt32(item["stemCount"]), Convert.ToInt64(item["wrappingFee"]))).ToArray(),
                zone is null ? null : zones.First(item => item.Id == (string)zone["id"]).ToResponse());
        }
        catch (BackendException exception) { throw CommerceException.Conflict(exception.Code, exception.Message); }
    }

    internal static CartLine[] NormalizedItems(IReadOnlyDictionary<string, object> normalized) =>
        ((List<Dictionary<string, object>>)normalized["items"]).Select(item => new CartLine(
            (string)item["id"], Convert.ToInt32(item["quantity"]), item.GetValueOrDefault("productId") as string,
            item.GetValueOrDefault("size") as string ?? "standard", item.GetValueOrDefault("color") as string ?? "original",
            item.GetValueOrDefault("cardMessage") as string ?? "", item.GetValueOrDefault("personalNote") as string ?? "",
            item.GetValueOrDefault("customBouquetId") as string ?? "")).ToArray();

    private static Cart Copy(Cart cart) => cart with { Items = cart.Items.ToArray() };
}
