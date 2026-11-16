using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Application.Common.Http;

public static class JsonInput
{
    private static readonly object BodyKey = new();
    public static void Cache(HttpContext context, JsonElement value) => context.Items[BodyKey] = value;
    public static JsonElement Property(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(name, out var result) ? result : default;

    public static async Task<JsonElement> ReadAsync(HttpContext context)
    {
        if (context.Items.TryGetValue(BodyKey, out var body) && body is JsonElement cached) return cached;
        if (context.Request.ContentLength == 0 || (context.Request.Body.CanSeek && context.Request.Body.Length == 0)) return default;
        using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
        var value = document.RootElement.Clone();
        context.Items[BodyKey] = value;
        return value;
    }
}
