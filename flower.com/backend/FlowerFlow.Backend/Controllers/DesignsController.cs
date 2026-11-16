using FlowerFlow.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/design-requests")]
public sealed class DesignsController(DesignService service) : ControllerBase
{
    [HttpPost, ProducesResponseType<CreatedDesign>(StatusCodes.Status201Created)]
    public async Task<ActionResult<CreatedDesign>> Create(CreateDesignRequest request, CancellationToken ct)
    { var created = await service.CreateAsync(request, ct); return Created($"/api/v1/design-requests/{created.Request.Id}", created); }
    [HttpGet, Authorize] public Task<IReadOnlyList<DesignResponse>> List(CancellationToken ct, bool manage = false) => service.ListAsync(manage, ct);
    [HttpGet("{id}")] public Task<DesignResponse> Get(string id, CancellationToken ct,
        [FromHeader(Name = "X-Design-Token")] string? accessToken = null) => service.GetAsync(id, accessToken, ct);
    [HttpPut("{id}"), Authorize(Policy = "Admin")]
    public Task<DesignResponse> Update(string id, DesignUpdateRequest request, CancellationToken ct) => service.UpdateAsync(id, request, ct);
    [HttpPost("{id}/response")]
    public Task<DesignResponse> Respond(string id, DesignRespondRequest request, CancellationToken ct,
        [FromHeader(Name = "X-Design-Token")] string? accessToken = null) => service.RespondAsync(id, request, accessToken, ct);
}
