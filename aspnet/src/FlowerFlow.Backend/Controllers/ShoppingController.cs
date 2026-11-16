using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize, Route("api/v1/cart")]
public sealed class CartController(ShoppingService service) : ControllerBase
{
    [HttpGet] public Task<Cart> Get(CancellationToken ct) => service.CartAsync(ct);
    [HttpPut] public Task<Cart> Put(CartRequest request, CancellationToken ct) => service.SaveCartAsync(request, ct);
}

[ApiController, Route("api/v1/quotes")]
public sealed class QuotesController(ShoppingService service) : ControllerBase
{
    [HttpPost] public Task<QuoteResponse> Create(QuoteRequest request, CancellationToken ct) => service.QuoteAsync(request, ct);
}

[ApiController, Route("api/v1/shop-settings")]
public sealed class ShopSettingsController(ShopSettingsService service) : ControllerBase
{
    [HttpGet("delivery-zones")] public Task<IReadOnlyList<DeliveryZone>> Zones(CancellationToken ct) => service.ZonesAsync(ct);
    [HttpPut("delivery-zones/{id}"), Authorize(Policy = "Owner")]
    public Task<DeliveryZone> Zone(string id, DeliveryZoneRequest request, CancellationToken ct) => service.SaveZoneAsync(id, request, ct);
    [HttpGet("promotions")] public Task<IReadOnlyList<Promotion>> Promotions(CancellationToken ct) => service.PromotionsAsync(ct);
    [HttpPut("promotions/{id}"), Authorize(Policy = "Admin")]
    public Task<Promotion> Promotion(string id, PromotionRequest request, CancellationToken ct) => service.SavePromotionAsync(id, request, ct);
    [HttpGet("wrapping")] public Task<WrappingSettings?> Wrapping(CancellationToken ct) => service.WrappingAsync(ct);
    [HttpPut("wrapping"), Authorize(Policy = "Owner")]
    public Task<WrappingSettings> Wrapping(WrappingRequest request, CancellationToken ct) => service.SaveWrappingAsync(request, ct);
}
