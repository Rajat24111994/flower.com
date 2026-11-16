using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Khu vực giao hàng và phí gói bó hoa. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class DeliveryZonesController(DeliveryZonesService zones, BouquetWrappingService wrapping) : ControllerBase
{
    [Route("api/delivery-zones")]
    public Task Zones() => zones.HandleAsync(HttpContext);

    [Route("api/bouquet-wrapping")]
    public Task Wrapping() => wrapping.HandleAsync(HttpContext);
}
