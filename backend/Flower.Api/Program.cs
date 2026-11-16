using Flower.Api;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot") });
builder.WebHost.ConfigureKestrel(options => { options.AddServerHeader = false; options.Limits.MaxRequestBodySize = 4_500_000; });
// ASP.NET's normal request logs include the query string (design bearer access tokens).
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Services.AddSingleton<FirebaseServices>();
builder.Services.AddSingleton<UserEndpoints>();
builder.Services.AddSingleton<CatalogEndpoints>();
builder.Services.AddSingleton<ImageEndpoints>();
builder.Services.AddSingleton<ProductEndpoints>();
builder.Services.AddSingleton<OrderEndpoints>();
builder.Services.AddSingleton<PaymentEndpoints>();
builder.Services.AddSingleton<DesignEndpoints>();
var app = builder.Build();
var trusted = builder.Configuration["TRUSTED_PROXY_IPS"]?.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];
if (trusted.Length > 0)
{
    var options = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, ForwardLimit = 1 };
    options.KnownIPNetworks.Clear(); options.KnownProxies.Clear();
    foreach (var address in trusted) options.KnownProxies.Add(IPAddress.Parse(address));
    app.UseForwardedHeaders(options);
}
using var security = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "security-headers.json")));
var headers = security.RootElement.GetProperty("headers")[0].GetProperty("headers").EnumerateArray().ToDictionary(h => h.GetProperty("key").GetString()!, h => h.GetProperty("value").GetString()!);
app.Use(async (context, next) =>
{
    foreach (var header in headers) context.Response.Headers[header.Key] = header.Value;
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    try { await next(context); }
    catch (ApiException error)
    {
        context.Response.StatusCode = error.Status;
        var failure = error.Code == "admin-api-not-configured" && context.Request.Path.Value is "/api/orders" or "/api/payments" or "/api/product-images" or "/api/review-images"
            ? ApiFailures.For(context) : (Code: error.Code, Message: error.Message);
        await context.Response.WriteAsJsonAsync(new { code = failure.Code, error = failure.Message });
    }
    catch (Exception error)
    {
        // Do not log SDK error messages, request bodies, tokens, or service-account JSON.
        app.Logger.LogError("API request failed ({ExceptionType})", error.GetType().Name);
        context.Response.StatusCode = 503;
        var failure = ApiFailures.For(context);
        await context.Response.WriteAsJsonAsync(new { code = failure.Code, error = failure.Message });
    }
});
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = file =>
    {
        var extension = Path.GetExtension(file.File.Name).ToLowerInvariant();
        file.Context.Response.Headers.CacheControl = extension switch
        {
            ".css" or ".js" or ".woff" or ".woff2" => "public, max-age=31536000, immutable",
            ".webp" or ".png" or ".jpg" or ".jpeg" or ".svg" or ".ico" => "public, max-age=86400, must-revalidate",
            _ => "public, max-age=0, must-revalidate"
        };
    }
});
app.Map("/api/admin/users", (HttpContext context, UserEndpoints users) => users.Handle(context, false));
app.Map("/api/owner/users", (HttpContext context, UserEndpoints users) => users.Handle(context, true));
app.Map("/api/bouquet-wrapping", (HttpContext context, CatalogEndpoints catalog) => catalog.Metadata(context, "bouquetWrapping"));
app.Map("/api/delivery-zones", (HttpContext context, CatalogEndpoints catalog) => catalog.Metadata(context, "deliveryZones"));
app.Map("/api/flower-prices", (HttpContext context, CatalogEndpoints catalog) => catalog.Prices(context));
app.Map("/api/products", (HttpContext context, ProductEndpoints products) => products.Handle(context));
app.Map("/api/product-images", (HttpContext context, ImageEndpoints images) => images.Handle(context, false));
app.Map("/api/review-images", (HttpContext context, ImageEndpoints images) => images.Handle(context, true));
app.Map("/api/orders", (HttpContext context, OrderEndpoints orders) => orders.Handle(context));
app.Map("/api/payments", (HttpContext context, PaymentEndpoints payments) => payments.Handle(context));
app.Map("/api/vnpay-ipn", (HttpContext context, PaymentEndpoints payments) => payments.Ipn(context));
app.Map("/api/design-requests", (HttpContext context, DesignEndpoints designs) => designs.Handle(context));
app.Run();

public partial class Program { }
