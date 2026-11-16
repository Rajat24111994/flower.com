using Google.Cloud.Firestore;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

var checkFirebase = args.Contains("--check-firebase", StringComparer.Ordinal);
var builder = WebApplication.CreateBuilder(args.Where(argument => argument != "--check-firebase").ToArray());
// Default request diagnostics include the full query string (design/payment access tokens).
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var development = builder.Environment.IsDevelopment();
var authMode = checkFirebase ? "firebase" : Environment.GetEnvironmentVariable("AUTH_MODE") ?? (development ? "local" : "firebase");
if (authMode is not "local" and not "firebase") throw new InvalidOperationException("AUTH_MODE phải là local hoặc firebase.");
if (authMode == "local" && !development) throw new InvalidOperationException("Tài khoản local chỉ được bật trong môi trường Development.");
var sourceFrontend = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "../.."));
var frontendRoot = Path.GetFullPath(builder.Configuration["FLOWER_FRONTEND_ROOT"] ??
    (development && File.Exists(Path.Combine(sourceFrontend, "vercel.json")) ? sourceFrontend : Path.Combine(AppContext.BaseDirectory, "frontend")));
var port = Environment.GetEnvironmentVariable("PORT");
if (port is not null)
{
    if (!int.TryParse(port, out var number) || number is < 1 or > 65535) throw new InvalidOperationException("PORT phải là số nguyên từ 1 đến 65535.");
    builder.WebHost.UseUrls($"http://{(development ? "127.0.0.1" : "0.0.0.0")}:{number}");
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
builder.Services.AddSingleton<FirebaseAdminService>();
builder.Services.AddSingleton<IFirebaseAdminService>(services => services.GetRequiredService<FirebaseAdminService>());
// Infrastructure implementations of the Application contracts.
builder.Services.AddSingleton<IFirebaseAuthService, FirebaseAuthService>();
builder.Services.AddSingleton<IRequestIdentityService, RequestIdentityService>();
builder.Services.AddSingleton<IAdminAuditRepository, AdminAuditRepository>();
builder.Services.AddSingleton<IVnpayGateway>(_ => new VnpayGateway());
builder.Services.AddSingleton<FirestoreService>();
builder.Services.AddSingleton<Func<FirestoreDb>>(services => services.GetRequiredService<FirestoreService>().GetDatabase);
// Application services; HTTP entry points are the controllers in FlowerFlow.Api/Controllers.
builder.Services.AddSingleton<ReviewImagesService>();
builder.Services.AddSingleton<ProductImagesService>();
builder.Services.AddSingleton<AuditService>();
builder.Services.AddSingleton<BouquetWrappingService>();
builder.Services.AddSingleton<DeliveryZonesService>();
builder.Services.AddSingleton<ReservationsService>();
builder.Services.AddSingleton<TrackingService>();
builder.Services.AddSingleton<FlowerPricesService>();
builder.Services.AddSingleton(_ => new ProductCatalog(Path.Combine(frontendRoot, "flower.json")));
builder.Services.AddSingleton<ProductsService>();
builder.Services.AddSingleton<WiltingPricesService>();
builder.Services.AddSingleton<DesignRequestsService>();
builder.Services.AddSingleton<ReviewsService>();
builder.Services.AddSingleton<PaymentAdminService>();
builder.Services.AddSingleton<IFirebaseAccounts, FirebaseAccounts>();
builder.Services.AddSingleton(_ => FrontendFirebaseConfig.Load(Path.Combine(frontendRoot, "js", "core", "firebase-config.js")));
builder.Services.AddHttpClient<PasswordAuthService>(client => client.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false }).RemoveAllLoggers();
builder.Services.AddSingleton<Func<IPasswordAuthService>>(services => () => services.GetRequiredService<PasswordAuthService>());
builder.Services.AddSingleton<Func<LoginProtectionService>>(services => () => new LoginProtectionService(services.GetRequiredService<FirestoreService>().GetDatabase()));
builder.Services.AddSingleton<LoginService>();
builder.Services.AddSingleton<LogoutService>();
builder.Services.AddSingleton<UsersService>();
builder.Services.AddSingleton<OwnerUsersService>();
builder.Services.AddSingleton<CheckoutService>();
builder.Services.AddSingleton<PaymentsService>();
builder.Services.AddSingleton<VnpayIpnService>();

var app = builder.Build();
if (checkFirebase)
{
    Environment.ExitCode = await FirebaseConnectionCheck.RunAsync(app.Services.GetRequiredService<FirebaseAdminService>(),
        Path.Combine(frontendRoot, "js", "core", "firebase-config.js"), Console.Out);
    await app.DisposeAsync();
    return;
}

if (proxies.Length > 0) app.UseForwardedHeaders();
if (!development) app.UseHsts();
var missingLoginConfiguration = development && authMode == "firebase" ? new[] { "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_AUTH_PUBLIC_API_KEY", "FIREBASE_AUTH_SERVER_API_KEY" }
    .Where(key => key == "FIREBASE_SERVICE_ACCOUNT_JSON" ? !FirebaseServiceAccount.IsConfigured() : string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key))).ToArray() : [];
var publicOrigins = new HashSet<string>(StringComparer.Ordinal);
if (!development)
{
    // Render terminates TLS before forwarding HTTP to the container. Use server-owned
    // public URLs, without trusting caller-supplied forwarded headers or changing client IPs.
    foreach (var key in new[] { "RENDER_EXTERNAL_URL", "PUBLIC_APP_URL" })
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrWhiteSpace(value)) continue;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not "https" and not "http" || uri.UserInfo.Length > 0)
            throw new InvalidOperationException("Public application URL configuration is invalid.");
        publicOrigins.Add(uri.GetLeftPart(UriPartial.Authority));
    }
}
if (!development && publicOrigins.Any(origin => origin.StartsWith("https://", StringComparison.Ordinal)))
{
    // UseHsts only fires for HTTPS requests; behind Render's TLS proxy the container sees HTTP,
    // so send the same policy as the Vercel deployment when the public origin is HTTPS.
    app.Use((context, next) =>
    {
        context.Response.Headers.StrictTransportSecurity = "max-age=31536000; includeSubDomains";
        return next(context);
    });
}
var serverOptions = new BackendServerOptions(frontendRoot, development, development ? authMode : null, missingLoginConfiguration)
{ PublicOrigins = publicOrigins };
app.Use(next => new BackendServer(next, serverOptions, authMode == "local" ? app.Services.GetRequiredService<LocalAuthHandler>() : null).InvokeAsync);
app.Use(next => new RequestIdentityMiddleware(next, authMode == "local" ? app.Services.GetRequiredService<ILocalAccountWorker>() : null).InvokeAsync);
app.UseRouting();
app.MapControllers();
app.Run();

public partial class Program;
