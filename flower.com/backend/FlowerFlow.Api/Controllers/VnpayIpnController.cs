using Microsoft.AspNetCore.Mvc;
namespace FlowerFlow.Api.Controllers;
public sealed class VnpayIpnController : ControllerBase
{
    [Route("api/vnpay-ipn")]
    public IActionResult Ipn() => StatusCode(410, new { code = "payment-method-removed", error = "Vui lòng thanh toán bằng QR chuyển khoản." });
}
