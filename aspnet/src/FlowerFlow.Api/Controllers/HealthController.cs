using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Api.Controllers;

[ApiController]
[Route("health")]
public sealed class HealthController : ControllerBase
{
    // Process liveness only. This does not claim Firebase/Firestore connectivity.
    [HttpGet]
    public IActionResult Get()
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(new { status = "ok", service = "flowerflow-api" });
    }
}
