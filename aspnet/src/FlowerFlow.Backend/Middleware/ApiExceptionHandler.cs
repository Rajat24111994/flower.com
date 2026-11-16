using FlowerFlow.Application.Commerce;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace FlowerFlow.Backend.Middleware;

public sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && context.RequestAborted.IsCancellationRequested) return false;
        var known = exception as CommerceException;
        var status = known?.Status ?? 500;
        if (known is null) logger.LogError(exception, "Unhandled backend error; trace {TraceId}", context.TraceIdentifier);
        context.Response.StatusCode = status;
        if (known?.RetryAfter is { } retryAfter) context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var details = new ProblemDetails
        {
            Status = status, Title = known?.Code ?? "internal-error",
            Detail = known?.Message ?? "Đã xảy ra lỗi khi xử lý yêu cầu.",
            Extensions = { ["code"] = known?.Code ?? "internal-error", ["traceId"] = context.TraceIdentifier }
        };
        if (!await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = details }))
            await context.Response.WriteAsJsonAsync(details, cancellationToken);
        return true;
    }
}
