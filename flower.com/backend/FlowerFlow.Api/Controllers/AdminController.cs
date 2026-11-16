using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Quản trị tài khoản và nhật ký quản trị. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class AdminController(UsersService users, AuditService audit) : ControllerBase
{
    [Route("api/admin/users")]
    public Task Users() => users.HandleAsync(HttpContext);

    [Route("api/admin/audit")]
    public Task Audit() => audit.HandleAsync(HttpContext);
}
