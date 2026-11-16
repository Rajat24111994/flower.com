using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Đăng nhập và đăng xuất mọi phiên. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class AccountsController(LoginService login, LogoutService logout) : ControllerBase
{
    [Route("api/login")]
    public Task Login() => login.HandleAsync(HttpContext);

    [Route("api/auth/logout-all")]
    public Task Logout() => logout.HandleAsync(HttpContext);
}
