using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Authorize(Policy = "Admin"), Route("api/v1/admin")]
public sealed class AdminController(AdminService service) : ControllerBase
{
    [HttpGet("users")] public Task<IReadOnlyList<ShopUser>> Users(CancellationToken ct) => service.UsersAsync(ct);
    [HttpPut("users/{id}/role"), Authorize(Policy = "Owner")]
    public Task<ShopUser> Role(string id, UserRoleRequest request, CancellationToken ct) => service.RoleAsync(id, request, ct);
    [HttpGet("audit")] public Task<Page<AuditEntry>> Audit(CancellationToken ct, int page = 1, int pageSize = 25) => service.AuditAsync(page, pageSize, ct);
}
