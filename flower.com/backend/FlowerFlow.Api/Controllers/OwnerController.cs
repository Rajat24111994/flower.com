using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Owner cấp hoặc gỡ quyền quản trị. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class OwnerController(OwnerUsersService users) : ControllerBase
{
    [Route("api/owner/users")]
    public Task Users() => users.HandleAsync(HttpContext);
}
