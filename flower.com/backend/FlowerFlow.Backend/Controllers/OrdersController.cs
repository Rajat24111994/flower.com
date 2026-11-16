using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/orders")]
public sealed class OrdersController(OrderService service) : ControllerBase
{
    [HttpPost, ProducesResponseType<CreatedOrder>(StatusCodes.Status201Created)]
    public async Task<ActionResult<CreatedOrder>> Create(CheckoutRequest request, CancellationToken ct)
    {
        var order = await service.CreateAsync(request, ct);
        return Created($"/api/v1/orders/{order.Id}", order);
    }
    [HttpGet, Authorize] public async Task<IReadOnlyList<OrderResponse>> List(CancellationToken ct, bool manage = false) =>
        (await service.ListAsync(manage, ct)).Select(item => item.ToResponse()).ToArray();
    [HttpGet("{id}"), Authorize] public async Task<OrderResponse> Get(string id, CancellationToken ct) => (await service.GetAsync(id, ct)).ToResponse();
    [HttpPost("tracking")] public Task<TrackingResponse> Track(TrackOrderRequest request, CancellationToken ct) => service.TrackAsync(request, ct);
    [HttpPut("{id}/status"), Authorize(Policy = "Admin")]
    public async Task<OrderResponse> Status(string id, OrderStatusRequest request, CancellationToken ct) => (await service.ChangeStatusAsync(id, request, ct)).ToResponse();
    [HttpPost("expire"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Expire(CancellationToken ct) => Ok(new { released = await service.ExpireAsync(ct) });
}
