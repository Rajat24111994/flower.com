using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Catalog;
using Google.Cloud.Firestore;
using FlowerFlow.Infrastructure.Admin;
using FlowerFlow.Infrastructure.ShopSettings;
using FlowerFlow.Infrastructure.Orders;
using FlowerFlow.Infrastructure.DesignRequests;
using FlowerFlow.Infrastructure.Accounts;
using FlowerFlow.Infrastructure.Payments;
using FlowerFlow.Infrastructure.Local;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

var builder = WebApplication.CreateBuilder(args);
// Default request diagnostics include the full query string (design/payment access tokens).
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var development = builder.Environment.IsDevelopment();
var authMode = Environment.GetEnvironmentVariable("AUTH_MODE") ?? (development ? "local" : "firebase");
if (authMode is not "local" and not "firebase") throw new InvalidOperationException("AUTH_MODE phải là local hoặc firebase.");
if (authMode == "local" && !development) throw new InvalidOperationException("Tài khoản local chỉ được bật trong môi trường Development.");
var sourceFrontend = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "../../../flower.com"));
var frontendRoot = Path.GetFullPath(builder.Configuration["FLOWER_FRONTEND_ROOT"] ??
    (development && File.Exists(Path.Combine(sourceFrontend, "vercel.json")) ? sourceFrontend : Path.Combine(AppContext.BaseDirectory, "frontend")));
var port = Environment.GetEnvironmentVariable("PORT");
if (development && port is not null)
{
    if (!int.TryParse(port, out var number) || number is < 1 or > 65535) throw new InvalidOperationException("PORT phải là số nguyên từ 1 đến 65535.");
    builder.WebHost.UseUrls($"http://127.0.0.1:{number}");
}
builder.WebHost.ConfigureKestrel(options => { options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30); options.Limits.MaxRequestBodySize = null; });
var proxies = builder.Configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
if (proxies.Length > 0) builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear(); options.KnownProxies.Clear();
    foreach (var proxy in proxies) options.KnownProxies.Add(IPAddress.Parse(proxy));
    options.ForwardLimit = 1;
});
if (authMode == "local")
{
    var filename = builder.Configuration["LOCAL_ACCOUNTS_FILE"] ?? Path.Combine(frontendRoot, ".tools", "local-auth", "accounts.sqlite");
    builder.Services.AddSingleton(_ => new LocalAccountWorker(filename));
    builder.Services.AddSingleton<ILocalAccountWorker>(services => services.GetRequiredService<LocalAccountWorker>());
    builder.Services.AddSingleton<LocalAuthHandler>();
}

builder.Services.AddControllers();
builder.Services.AddHsts(options => { options.MaxAge = TimeSpan.FromDays(365); options.IncludeSubDomains = true; });
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<FirebaseAdminBackend>();
builder.Services.AddSingleton<IFirebaseAdminBackend>(services => services.GetRequiredService<FirebaseAdminBackend>());
builder.Services.AddSingleton<FirebaseAdminService>();
builder.Services.AddSingleton<RequestIdentity>();
builder.Services.AddSingleton<Func<FirestoreDb>>(services => () => services.GetRequiredService<FirebaseAdminBackend>().GetAdminFirestore());
builder.Services.AddSingleton<ReviewImagesHandler>();
builder.Services.AddSingleton<ProductImagesHandler>();
builder.Services.AddSingleton<AdminAuditHandler>();
builder.Services.AddSingleton<BouquetWrappingHandler>();
builder.Services.AddSingleton<DeliveryZonesHandler>();
builder.Services.AddSingleton<Reservations>();
builder.Services.AddSingleton<OrderTracking>();
builder.Services.AddSingleton<FlowerPricesHandler>();
builder.Services.AddSingleton(_ => new ProductCatalog(Path.Combine(frontendRoot, "flower.json")));
builder.Services.AddSingleton<ProductsHandler>();
builder.Services.AddSingleton<DesignRequestsHandler>();
builder.Services.AddSingleton<OrderReviews>();
builder.Services.AddSingleton<PaymentAdmin>();
builder.Services.AddSingleton<IFirebaseAccounts, FirebaseAccounts>();
builder.Services.AddSingleton(_ => FrontendFirebaseConfig.Load(Path.Combine(frontendRoot, "js", "core", "firebase-config.js")));
builder.Services.AddHttpClient<PasswordAuth>(client => client.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false }).RemoveAllLoggers();
builder.Services.AddSingleton<Func<IPasswordAuth>>(services => () => services.GetRequiredService<PasswordAuth>());
builder.Services.AddSingleton<Func<LoginProtection>>(services => () => new LoginProtection(services.GetRequiredService<FirebaseAdminBackend>().GetAdminFirestore()));
builder.Services.AddSingleton<LoginHandler>();
builder.Services.AddSingleton<AdminUsersHandler>();
builder.Services.AddSingleton<OwnerUsersHandler>();
builder.Services.AddSingleton<Checkout>();
builder.Services.AddSingleton<OrdersHandler>();
builder.Services.AddSingleton<PaymentsHandler>();
builder.Services.AddSingleton<VnpayIpnHandler>();

var app = builder.Build();

if (proxies.Length > 0) app.UseForwardedHeaders();
if (!development) app.UseHsts();
var missingLoginConfiguration = development && authMode == "firebase" ? new[] { "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_AUTH_PUBLIC_API_KEY", "FIREBASE_AUTH_SERVER_API_KEY" }
    .Where(key => string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key))).ToArray() : [];
var serverOptions = new BackendServerOptions(frontendRoot, development, development ? authMode : null, missingLoginConfiguration);
app.Use(next => new BackendServer(next, serverOptions, authMode == "local" ? app.Services.GetRequiredService<ILocalAccountWorker>() : null,
    authMode == "local" ? app.Services.GetRequiredService<LocalAuthHandler>() : null).InvokeAsync);
app.UseRouting();
app.MapControllers();
app.Map("/api/review-images", (HttpContext context, ReviewImagesHandler handler) => handler.HandleAsync(context));
app.Map("/api/product-images", (HttpContext context, ProductImagesHandler handler) => handler.HandleAsync(context));
app.Map("/api/admin/audit", (HttpContext context, AdminAuditHandler handler) => handler.HandleAsync(context));
app.Map("/api/bouquet-wrapping", (HttpContext context, BouquetWrappingHandler handler) => handler.HandleAsync(context));
app.Map("/api/delivery-zones", (HttpContext context, DeliveryZonesHandler handler) => handler.HandleAsync(context));
app.Map("/api/flower-prices", (HttpContext context, FlowerPricesHandler handler) => handler.HandleAsync(context));
app.Map("/api/products", (HttpContext context, ProductsHandler handler) => handler.HandleAsync(context));
app.Map("/api/design-requests", (HttpContext context, DesignRequestsHandler handler) => handler.HandleAsync(context));
app.Map("/api/login", (HttpContext context, LoginHandler handler) => handler.HandleAsync(context));
app.Map("/api/admin/users", (HttpContext context, AdminUsersHandler handler) => handler.HandleAsync(context));
app.Map("/api/owner/users", (HttpContext context, OwnerUsersHandler handler) => handler.HandleAsync(context));
app.Map("/api/orders", (HttpContext context, OrdersHandler handler) => handler.HandleAsync(context));
app.Map("/api/payments", (HttpContext context, PaymentsHandler handler) => handler.HandleAsync(context));
app.Map("/api/vnpay-ipn", (HttpContext context, VnpayIpnHandler handler) => handler.HandleAsync(context));
app.Run();

public partial class Program;
