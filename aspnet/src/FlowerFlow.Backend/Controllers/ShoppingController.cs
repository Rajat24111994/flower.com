using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize, Route("api/v1/cart")]
public sealed class CartController(ShoppingService service) : ControllerBase
{
    [HttpGet] public async Task<CartResponse> Get(CancellationToken ct) => (await service.CartAsync(ct)).ToResponse();
    [HttpPut] public async Task<CartResponse> Put(CartRequest request, CancellationToken ct) => (await service.SaveCartAsync(request, ct)).ToResponse();
}

[ApiController, Route("api/v1/quotes")]
public sealed class QuotesController(ShoppingService service) : ControllerBase
{
    [HttpPost] public Task<QuoteResponse> Create(QuoteRequest request, CancellationToken ct) => service.QuoteAsync(request, ct);
}

[ApiController, Route("api/v1/shop-settings")]
public sealed class ShopSettingsController(ShopSettingsService service) : ControllerBase
{
    [HttpGet("delivery-zones")] public async Task<IReadOnlyList<DeliveryZoneResponse>> Zones(CancellationToken ct) => (await service.ZonesAsync(ct)).Select(item => item.ToResponse()).ToArray();
    [HttpPut("delivery-zones/{id}"), Authorize(Policy = "Owner")]
    public async Task<DeliveryZoneResponse> Zone(string id, DeliveryZoneRequest request, CancellationToken ct) => (await service.SaveZoneAsync(id, request, ct)).ToResponse();
    [HttpGet("promotions")] public async Task<IReadOnlyList<PromotionResponse>> Promotions(CancellationToken ct) => (await service.PromotionsAsync(ct)).Select(item => item.ToResponse()).ToArray();
    [HttpPut("promotions/{id}"), Authorize(Policy = "Admin")]
    public async Task<PromotionResponse> Promotion(string id, PromotionRequest request, CancellationToken ct) => (await service.SavePromotionAsync(id, request, ct)).ToResponse();
    [HttpGet("wrapping")] public async Task<WrappingResponse?> Wrapping(CancellationToken ct) => (await service.WrappingAsync(ct))?.ToResponse();
    [HttpPut("wrapping"), Authorize(Policy = "Owner")]
    public async Task<WrappingResponse> Wrapping(WrappingRequest request, CancellationToken ct) => (await service.SaveWrappingAsync(request, ct)).ToResponse();
}
