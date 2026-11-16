using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize(Policy = "Admin"), Route("api/v1/admin")]
public sealed class AdminController(AdminService service) : ControllerBase
{
    [HttpGet("users")] public async Task<IReadOnlyList<UserResponse>> Users(CancellationToken ct) => (await service.UsersAsync(ct)).Select(item => item.ToResponse()).ToArray();
    [HttpPut("users/{id}/role"), Authorize(Policy = "Owner")]
    public async Task<UserResponse> Role(string id, UserRoleRequest request, CancellationToken ct) => (await service.RoleAsync(id, request, ct)).ToResponse();
    [HttpGet("audit")] public async Task<Page<AuditEntryResponse>> Audit(CancellationToken ct, int page = 1, int pageSize = 25)
    {
        var result = await service.AuditAsync(page, pageSize, ct);
        return new(result.Items.Select(item => item.ToResponse()).ToArray(), result.Total, result.PageNumber, result.PageSize);
    }
}
