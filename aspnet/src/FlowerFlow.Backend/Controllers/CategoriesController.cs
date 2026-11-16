using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Controllers;

[ApiController, Route("api/v1/categories")]
public sealed class CategoriesController(CatalogService service) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<Category>> List(CancellationToken ct) => service.CategoriesAsync(ct);
    [HttpGet("{id}")]
    public async Task<ActionResult<Category>> Get(string id, CancellationToken ct) =>
        (await service.CategoriesAsync(ct)).FirstOrDefault(item => item.Id == id) is { } category ? Ok(category) : NotFound();
    [HttpPost, Authorize(Policy = "Admin")]
    public async Task<ActionResult<Category>> Create(CategoryRequest request, CancellationToken ct)
    {
        var category = await service.SaveCategoryAsync(null, request, ct);
        return CreatedAtAction(nameof(Get), new { id = category.Id }, category);
    }
    [HttpPut("{id}"), Authorize(Policy = "Admin")]
    public Task<Category> Update(string id, CategoryRequest request, CancellationToken ct) => service.SaveCategoryAsync(id, request, ct);
    [HttpDelete("{id}"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    { await service.DeleteCategoryAsync(id, ct); return NoContent(); }
}
