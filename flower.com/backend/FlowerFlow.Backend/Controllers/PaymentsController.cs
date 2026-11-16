using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize, Route("api/v1")]
public sealed class PaymentsController(PaymentService service) : ControllerBase
{
    [HttpPost("orders/{orderId}/payments"), AllowAnonymous]
    [ProducesResponseType<PaymentAttemptResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<PaymentAttemptResponse>> Create(string orderId, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null)
    { var result = await service.CreateAttemptAsync(orderId, ct, reference); return Created($"/api/v1/payments/{result.Id}", result.ToResponse()); }
    [HttpGet("payments/{id}"), AllowAnonymous] public async Task<PaymentAttemptResponse> Get(string id, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null) => (await service.GetAttemptAsync(id, ct, reference)).ToResponse();
    [HttpPost("payments/{id}/retry"), AllowAnonymous] public async Task<PaymentAttemptResponse> Retry(string id, CancellationToken ct,
        [FromHeader(Name = "X-Payment-Reference")] string? reference = null) => (await service.RetryAsync(id, ct, reference)).ToResponse();
    [HttpPost("payments/{id}/simulation"), Authorize(Policy = "Owner")]
    public async Task<PaymentAttemptResponse> Simulate(string id, SimulatePaymentRequest request, CancellationToken ct) => (await service.SimulateAsync(id, request, ct)).ToResponse();
    [HttpPost("orders/{orderId}/qr-reconciliation"), Authorize(Policy = "Admin")]
    public async Task<PaymentAuditResponse> Qr(string orderId, ReconciliationRequest request, CancellationToken ct) => (await service.ReconcileQrAsync(orderId, request, ct)).ToResponse();
    [HttpPost("orders/{orderId}/refunds"), Authorize(Policy = "Admin")]
    public async Task<PaymentAuditResponse> Refund(string orderId, RefundRequest request, CancellationToken ct) => (await service.RefundAsync(orderId, request, ct)).ToResponse();
    [HttpGet("orders/{orderId}/payment-audit"), Authorize(Policy = "Admin")]
    public async Task<IReadOnlyList<PaymentAuditResponse>> History(string orderId, CancellationToken ct) => (await service.HistoryAsync(orderId, ct)).Select(item => item.ToResponse()).ToArray();
}
