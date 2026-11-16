using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Tạo và theo dõi thanh toán VNPay. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class PaymentsController(PaymentsService payments) : ControllerBase
{
    [Route("api/payments")]
    public Task Payments() => payments.HandleAsync(HttpContext);
}
