using System.ComponentModel.DataAnnotations;
using System.Reflection;

namespace FlowerFlow.Application.Commerce;

public sealed record CategoryRequest([Required, StringLength(80, MinimumLength = 1)] string Name);
public sealed record ProductRequest(
    [Required, StringLength(120, MinimumLength = 1)] string Title,
    [Required, StringLength(1000, MinimumLength = 1)] string Description,
    [Required] string Image,
    [Required, MaxLength(8)] string[] Images,
    string? CategoryId,
    [Range(1000, 9_007_199_254_740_991)] long Price,
    [Range(0, 9_007_199_254_740_991)] long Quantity,
    [Required, RegularExpression("^(ready_made|flower)$")] string SaleType = "ready_made",
    [Required, RegularExpression("^(active|hidden)$")] string Status = "active",
    [StringLength(1000)] string Meaning = "",
    string[]? Colors = null, string[]? Occasions = null,
    [Range(1, long.MaxValue)] long? ExpectedVersion = null);
public sealed record ProductResponse(string Id, string Title, string Description, string Image,
    IReadOnlyList<string> Images, string? CategoryId, string Category, long Price, long Quantity,
    string SaleType, string Status, string Meaning, IReadOnlyList<string> Colors,
    IReadOnlyList<string> Occasions, long Version, long SoldCount);
public sealed record PriceRequest([Range(1000, 1_000_000_000)] long Price,
    [Range(1, long.MaxValue)] long ExpectedVersion);
public sealed record InventoryRequest([Range(-9_007_199_254_740_991, 9_007_199_254_740_991)] long Delta,
    [Required, StringLength(200, MinimumLength = 1)] string Reason,
    [Range(1, long.MaxValue)] long ExpectedVersion);
public sealed record Page<T>(IReadOnlyList<T> Items, int Total, int PageNumber, int PageSize);

internal static class InputValidation
{
    public static void Validate(object value)
    {
        var errors = new List<ValidationResult>();
        Validator.TryValidateObject(value, new ValidationContext(value), errors, true);
        // MVC uses constructor-parameter annotations for positional records. Apply the
        // same annotations when a service is called directly, outside an HTTP request.
        var constructor = value.GetType().GetConstructors().OrderByDescending(item => item.GetParameters().Length).FirstOrDefault();
        foreach (var parameter in constructor?.GetParameters() ?? [])
        {
            var property = value.GetType().GetProperty(parameter.Name!);
            if (property is null) continue;
            foreach (var rule in parameter.GetCustomAttributes<ValidationAttribute>())
            {
                var error = rule.GetValidationResult(property.GetValue(value), new ValidationContext(value) { MemberName = property.Name });
                if (error is not null) errors.Add(error);
            }
        }
        if (errors.Count > 0)
            throw new CommerceException(400, "invalid-argument", string.Join(" ", errors.Select(error => error.ErrorMessage)));
    }
}
