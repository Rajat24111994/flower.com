using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

/// <summary>Ảnh đánh giá. Mọi phương thức HTTP đi tới service; service tự trả mã lỗi/405 như API cũ.</summary>
public sealed class ReviewImagesController(ReviewImagesService images) : ControllerBase
{
    [Route("api/review-images")]
    public Task Images() => images.HandleAsync(HttpContext);
}
