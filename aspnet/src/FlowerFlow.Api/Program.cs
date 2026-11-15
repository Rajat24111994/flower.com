using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<FirebaseAdminBackend>();
builder.Services.AddSingleton<IFirebaseAdminBackend>(services => services.GetRequiredService<FirebaseAdminBackend>());
builder.Services.AddSingleton<FirebaseAdminService>();
builder.Services.AddSingleton<RequestIdentity>();

var app = builder.Build();

app.UseExceptionHandler();
app.MapControllers();
app.Run();

public partial class Program;
