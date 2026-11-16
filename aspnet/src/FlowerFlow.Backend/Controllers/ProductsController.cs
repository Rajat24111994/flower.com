using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/products")]
public sealed class ProductsController(CatalogService service) : ControllerBase
{
    [HttpGet]
    public Task<Page<ProductResponse>> List(CancellationToken ct, string? search = null, string? categoryId = null,
        int page = 1, int pageSize = 20, bool manage = false) => service.ProductsAsync(search, categoryId, page, pageSize, manage, ct);
    [HttpGet("{id}")]
    public Task<ProductResponse> Get(string id, CancellationToken ct, bool manage = false) => service.ProductAsync(id, manage, ct);
    [HttpPost, Authorize(Policy = "Admin")]
    public async Task<ActionResult<ProductResponse>> Create(ProductRequest request, CancellationToken ct)
    {
        var product = await service.SaveProductAsync(null, request, ct);
        return CreatedAtAction(nameof(Get), new { id = product.Id }, product);
    }
    [HttpPut("{id}"), Authorize(Policy = "Admin")]
    public Task<ProductResponse> Update(string id, ProductRequest request, CancellationToken ct) => service.SaveProductAsync(id, request, ct);
    [HttpDelete("{id}"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Hide(string id, [FromQuery] long expectedVersion, CancellationToken ct)
    { await service.HideProductAsync(id, expectedVersion, ct); return NoContent(); }
    [HttpPut("{id}/flower-price"), Authorize(Policy = "Owner")]
    public Task<PriceChange> Price(string id, PriceRequest request, CancellationToken ct) => service.ChangeFlowerPriceAsync(id, request, ct);
    [HttpGet("{id}/price-history"), Authorize(Policy = "Owner")]
    public Task<IReadOnlyList<PriceChange>> Prices(string id, CancellationToken ct) => service.PriceHistoryAsync(id, ct);
    [HttpPost("{id}/inventory-adjustments"), Authorize(Policy = "Admin")]
    public Task<InventoryChange> Inventory(string id, InventoryRequest request, CancellationToken ct) => service.AdjustInventoryAsync(id, request, ct);
    [HttpGet("{id}/inventory-adjustments"), Authorize(Policy = "Admin")]
    public Task<IReadOnlyList<InventoryChange>> InventoryHistory(string id, CancellationToken ct) => service.InventoryHistoryAsync(id, ct);
}
