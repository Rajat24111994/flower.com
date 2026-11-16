using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/orders")]
public sealed class OrdersController(OrderService service) : ControllerBase
{
    [HttpPost] public async Task<ActionResult<CreatedOrder>> Create(CheckoutRequest request, CancellationToken ct)
    {
        var order = await service.CreateAsync(request, ct);
        return Created($"/api/v1/orders/{order.Id}", order);
    }
    [HttpGet, Authorize] public Task<IReadOnlyList<Order>> List(CancellationToken ct, bool manage = false) => service.ListAsync(manage, ct);
    [HttpGet("{id}"), Authorize] public Task<Order> Get(string id, CancellationToken ct) => service.GetAsync(id, ct);
    [HttpPost("tracking")] public Task<TrackingResponse> Track(TrackOrderRequest request, CancellationToken ct) => service.TrackAsync(request, ct);
    [HttpPut("{id}/status"), Authorize(Policy = "Admin")]
    public Task<Order> Status(string id, OrderStatusRequest request, CancellationToken ct) => service.ChangeStatusAsync(id, request, ct);
    [HttpPost("expire"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Expire(CancellationToken ct) => Ok(new { released = await service.ExpireAsync(ct) });
}
