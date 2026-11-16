using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/categories")]
public sealed class CategoriesController(CatalogService service) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<CategoryResponse>> List(CancellationToken ct) =>
        (await service.CategoriesAsync(ct)).Select(item => item.ToResponse()).ToArray();
    [HttpGet("{id}")]
    public async Task<ActionResult<CategoryResponse>> Get(string id, CancellationToken ct) =>
        (await service.CategoriesAsync(ct)).FirstOrDefault(item => item.Id == id) is { } category ? Ok(category.ToResponse()) : NotFound();
    [HttpPost, Authorize(Policy = "Admin")]
    public async Task<ActionResult<CategoryResponse>> Create(CategoryRequest request, CancellationToken ct)
    {
        var category = await service.SaveCategoryAsync(null, request, ct);
        return CreatedAtAction(nameof(Get), new { id = category.Id }, category.ToResponse());
    }
    [HttpPut("{id}"), Authorize(Policy = "Admin")]
    public async Task<CategoryResponse> Update(string id, CategoryRequest request, CancellationToken ct) =>
        (await service.SaveCategoryAsync(id, request, ct)).ToResponse();
    [HttpDelete("{id}"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    { await service.DeleteCategoryAsync(id, ct); return NoContent(); }
}
