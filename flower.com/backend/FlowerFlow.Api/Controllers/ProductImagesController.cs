using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Ảnh sản phẩm. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class ProductImagesController(ProductImagesService images) : ControllerBase
{
    [Route("api/product-images")]
    public Task Images() => images.HandleAsync(HttpContext);
}
