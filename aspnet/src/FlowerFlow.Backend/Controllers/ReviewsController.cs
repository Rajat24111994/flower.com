using FlowerFlow.Application.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/reviews")]
public sealed class ReviewsController(ReviewService service) : ControllerBase
{
    [HttpGet] public Task<IReadOnlyList<ReviewResponse>> List(CancellationToken ct, string? productId = null, bool manage = false) => service.ListAsync(productId, manage, ct);
    [HttpPost, Authorize, ProducesResponseType<ReviewResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<ReviewResponse>> Create(ReviewRequest request, CancellationToken ct)
    { var review = await service.CreateAsync(request, ct); return Created($"/api/v1/reviews?productId={Uri.EscapeDataString(review.ProductIds[0])}", review); }
    [HttpGet("own/{orderId}"), Authorize] public Task<ReviewResponse?> Own(string orderId, CancellationToken ct) => service.OwnAsync(orderId, ct);
    [HttpPut("{id}/moderation"), Authorize(Policy = "Admin")]
    public Task<ReviewResponse> Moderate(string id, ReviewModerationRequest request, CancellationToken ct) => service.ModerateAsync(id, request, ct);
    [HttpGet("{id}/photos/{index:int}")]
    public async Task<IActionResult> Photo(string id, int index, CancellationToken ct) => File(await service.PhotoAsync(id, index, ct), "image/jpeg");
}
