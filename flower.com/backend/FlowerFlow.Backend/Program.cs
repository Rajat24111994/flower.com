using FlowerFlow.Commerce;
using FlowerFlow.Backend.Configurations;
using FlowerFlow.Backend.Middleware;
using FlowerFlow.InMemory;
using Microsoft.AspNetCore.Authentication;
using Microsoft.OpenApi;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
// This host cannot accidentally replace production while its storage and identity are simulated.
if (!builder.Environment.IsDevelopment() && !builder.Environment.IsEnvironment("Testing"))
    throw new InvalidOperationException("The independent in-memory backend requires Development or Testing environment.");

builder.Services.AddOptions<BackendOptions>().BindConfiguration("Backend")
    .Validate(options => options.Storage == "InMemory", "Only InMemory storage is supported at this stage.")
    .ValidateOnStart();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddSingleton<ICommerceUnitOfWork, InMemoryUnitOfWork>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentActor, HttpCurrentActor>();
builder.Services.AddScoped<CatalogService>();
builder.Services.AddScoped<ShoppingService>();
builder.Services.AddScoped<ShopSettingsService>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<PaymentService>();
builder.Services.AddScoped<ReviewService>();
builder.Services.AddScoped<DesignService>();
builder.Services.AddScoped<AdminService>();
builder.Services.AddHostedService<ReservationCleanup>();
builder.Services.AddSingleton<IPaymentGateway, SimulatedPaymentGateway>();
builder.Services.AddAuthentication(DevelopmentAuthentication.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, DevelopmentAuthentication>(DevelopmentAuthentication.SchemeName, _ => { });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Admin", policy => policy.RequireAuthenticatedUser().RequireRole("admin", "owner"));
    options.AddPolicy("Owner", policy => policy.RequireAuthenticatedUser().RequireRole("owner"));
});
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new ValidationProblemDetails(context.ModelState)
    {
        Status = 400, Title = "invalid-argument",
        Extensions = { ["code"] = "invalid-argument", ["traceId"] = context.HttpContext.TraceIdentifier }
    });
});
builder.Services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
    context.ProblemDetails.Extensions["traceId"] = context.HttpContext.TraceIdentifier);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info = new OpenApiInfo { Title = "FlowerFlow independent backend", Version = "v1",
            Description = "In-memory data. Development identities only. Existing website and Firebase are unchanged." };
        document.Components ??= new();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes["DevelopmentUser"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.ApiKey, In = ParameterLocation.Header, Name = "X-Development-User",
            Description = "Local testing: owner, admin, customer-a or customer-b. This is NOT production authentication."
        };
        document.Security ??= [];
        document.Security.Add(new OpenApiSecurityRequirement
        { [new OpenApiSecuritySchemeReference("DevelopmentUser", document)] = [] });
        return Task.CompletedTask;
    });
    options.AddOperationTransformer((operation, context, _) =>
    {
        var metadata = context.Description.ActionDescriptor.EndpointMetadata;
        if (!metadata.OfType<IAuthorizeData>().Any() || metadata.OfType<IAllowAnonymous>().Any())
            operation.Security = [];
        return Task.CompletedTask;
    });
});

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages(async status =>
{
    var context = status.HttpContext;
    var code = context.Response.StatusCode switch
    {
        401 => "unauthenticated", 403 => "forbidden", 404 => "not-found", 405 => "method-not-allowed", _ => "http-error"
    };
    await Results.Problem(statusCode: context.Response.StatusCode,
        extensions: new Dictionary<string, object?> { ["code"] = code, ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
});
// Do not expose development identity impersonation on a non-loopback interface.
app.Use(async (context, next) =>
{
    var address = context.Connection.RemoteIpAddress;
    if (address is not null && !System.Net.IPAddress.IsLoopback(address))
    { context.Response.StatusCode = 403; return; }
    context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
app.UseAuthentication();
app.Use(async (context, next) =>
{
    if (context.Request.Headers.ContainsKey("X-Development-User") && context.User.Identity?.IsAuthenticated != true)
    { await context.ChallengeAsync(); return; }
    await next(context);
});
app.UseAuthorization();
app.MapControllers();
app.MapOpenApi();
app.UseSwaggerUI(options => options.SwaggerEndpoint("/openapi/v1.json", "FlowerFlow v1"));
app.Run();

public partial class Program;
