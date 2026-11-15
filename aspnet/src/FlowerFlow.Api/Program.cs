using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Catalog;
using Google.Cloud.Firestore;
using FlowerFlow.Infrastructure.Admin;

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

var app = builder.Build();

app.UseExceptionHandler();
app.MapControllers();
app.Map("/api/review-images", (HttpContext context, ReviewImagesHandler handler) => handler.HandleAsync(context));
app.Map("/api/product-images", (HttpContext context, ProductImagesHandler handler) => handler.HandleAsync(context));
app.Map("/api/admin/audit", (HttpContext context, AdminAuditHandler handler) => handler.HandleAsync(context));
app.Run();

public partial class Program;
