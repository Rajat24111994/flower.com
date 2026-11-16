using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Application.Common.Http;

/// <summary>The legacy API error body: <c>{ code, error }</c> with the given status.</summary>
public static class ApiResponse
{
    public static Task SendErrorAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { code, error = message }, context.RequestAborted);
    }
}
