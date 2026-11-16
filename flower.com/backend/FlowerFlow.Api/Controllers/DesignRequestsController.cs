using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Yêu cầu thiết kế bó hoa riêng. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class DesignRequestsController(DesignRequestsService requests) : ControllerBase
{
    [Route("api/design-requests")]
    public Task Requests() => requests.HandleAsync(HttpContext);
}
