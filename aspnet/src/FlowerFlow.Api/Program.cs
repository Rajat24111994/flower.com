using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Catalog;
using Google.Cloud.Firestore;
using FlowerFlow.Infrastructure.Admin;
using FlowerFlow.Infrastructure.ShopSettings;
using FlowerFlow.Infrastructure.Orders;
using FlowerFlow.Infrastructure.DesignRequests;
using FlowerFlow.Infrastructure.Accounts;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
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
builder.Services.AddSingleton(_ => new ProductCatalog(Path.Combine(AppContext.BaseDirectory, "catalog", "flower.json")));
builder.Services.AddSingleton<ProductsHandler>();
builder.Services.AddSingleton<DesignRequestsHandler>();
builder.Services.AddSingleton<OrderReviews>();
builder.Services.AddSingleton<PaymentAdmin>();
builder.Services.AddSingleton<IFirebaseAccounts, FirebaseAccounts>();
builder.Services.AddSingleton(_ => FrontendFirebaseConfig.Load(Path.Combine(AppContext.BaseDirectory, "catalog", "firebase-config.js")));
builder.Services.AddHttpClient<PasswordAuth>(client => client.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false }).RemoveAllLoggers();
builder.Services.AddSingleton<Func<IPasswordAuth>>(services => () => services.GetRequiredService<PasswordAuth>());
builder.Services.AddSingleton<Func<LoginProtection>>(services => () => new LoginProtection(services.GetRequiredService<FirebaseAdminBackend>().GetAdminFirestore()));
builder.Services.AddSingleton<LoginHandler>();
builder.Services.AddSingleton<AdminUsersHandler>();
builder.Services.AddSingleton<OwnerUsersHandler>();
builder.Services.AddSingleton<Checkout>();

var app = builder.Build();

app.UseExceptionHandler();
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
app.Run();

public partial class Program;
