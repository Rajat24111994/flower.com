using System.Collections.ObjectModel;
using FlowerFlow.Infrastructure.Firebase;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Infrastructure.Http;

/// <summary>Port of shared/api-routes.js; supports legacy ?route= aliases as well as direct URLs.</summary>
public sealed class ApiRoutes(RequestDelegate defaultHandler, IReadOnlyDictionary<string, RequestDelegate> routes)
{
    public IReadOnlyDictionary<string, RequestDelegate> Routes { get; } =
        new ReadOnlyDictionary<string, RequestDelegate>(new Dictionary<string, RequestDelegate>(routes, StringComparer.Ordinal));

    public Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Query.TryGetValue("route", out var route)) return defaultHandler(context);
        if (route.Count == 1 && Routes.TryGetValue(route[0]!, out var handler)) return handler(context);
        context.Response.Headers.CacheControl = "no-store";
        return FirebaseAdminService.SendErrorAsync(context, 404, "api-not-found", "Không tìm thấy API.");
    }
}
