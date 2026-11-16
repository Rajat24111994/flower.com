using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Danh mục sản phẩm, giá hoa và giá theo độ tươi. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class ProductsController(ProductsService products, FlowerPricesService flowerPrices, WiltingPricesService wiltingPrices) : ControllerBase
{
    [Route("api/products")]
    public Task Products() => products.HandleAsync(HttpContext);

    [Route("api/flower-prices")]
    public Task FlowerPrices() => flowerPrices.HandleAsync(HttpContext);

    [Route("api/wilting-prices")]
    public Task WiltingPrices() => wiltingPrices.HandleAsync(HttpContext);
}
