using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Callback IPN có chữ ký từ VNPay. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class VnpayIpnController(VnpayIpnService ipn) : ControllerBase
{
    [Route("api/vnpay-ipn")]
    public Task Ipn() => ipn.HandleAsync(HttpContext);
}
