using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize, Route("api/v1")]
public sealed class PaymentsController(PaymentService service) : ControllerBase
{
    [HttpPost("orders/{orderId}/payments"), AllowAnonymous]
    public async Task<ActionResult<PaymentAttempt>> Create(string orderId, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null)
    { var result = await service.CreateAttemptAsync(orderId, ct, reference); return Created($"/api/v1/payments/{result.Id}", result); }
    [HttpGet("payments/{id}"), AllowAnonymous] public Task<PaymentAttempt> Get(string id, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null) => service.GetAttemptAsync(id, ct, reference);
    [HttpPost("payments/{id}/retry"), AllowAnonymous] public Task<PaymentAttempt> Retry(string id, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null) => service.RetryAsync(id, ct, reference);
    [HttpPost("payments/{id}/simulation"), Authorize(Policy = "Owner")]
    public Task<PaymentAttempt> Simulate(string id, SimulatePaymentRequest request, CancellationToken ct) => service.SimulateAsync(id, request, ct);
    [HttpPost("orders/{orderId}/qr-reconciliation"), Authorize(Policy = "Admin")]
    public Task<PaymentAudit> Qr(string orderId, ReconciliationRequest request, CancellationToken ct) => service.ReconcileQrAsync(orderId, request, ct);
    [HttpPost("orders/{orderId}/refunds"), Authorize(Policy = "Admin")]
    public Task<PaymentAudit> Refund(string orderId, RefundRequest request, CancellationToken ct) => service.RefundAsync(orderId, request, ct);
    [HttpGet("orders/{orderId}/payment-audit"), Authorize(Policy = "Admin")]
    public Task<IReadOnlyList<PaymentAudit>> History(string orderId, CancellationToken ct) => service.HistoryAsync(orderId, ct);
}
