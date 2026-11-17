using Microsoft.AspNetCore.Mvc;
namespace FlowerFlow.Api.Controllers;
public sealed class PaymentsController : ControllerBase
{
    [Route("api/payments")]
    public IActionResult Payments() => StatusCode(410, new { code = "payment-method-removed", error = "Vui lòng thanh toán bằng QR chuyển khoản." });
}
