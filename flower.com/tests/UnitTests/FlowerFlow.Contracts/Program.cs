using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

// Differential contract checks against the actual JS source; no live Firebase credentials needed.
var rootArgument = args.FirstOrDefault(argument => !argument.StartsWith("--", StringComparison.Ordinal));
var root = rootArgument is not null ? Path.GetFullPath(rootArgument) : Directory.GetCurrentDirectory();
if (args.Contains("--wilting")) { WiltingPriceContracts.Run(); return; }
if (args.Contains("--hanoi-delivery")) { HanoiDeliveryContracts.Run(); return; }
if (args.Contains("--shared")) { await SharedContracts.RunAsync(root); return; }
if (args.Contains("--local-accounts")) { await LocalAccountContracts.RunAsync(root); return; }
if (args.Contains("--local-worker")) { await LocalWorkerContracts.RunAsync(); return; }
if (args.Contains("--local-http")) { await LocalHttpContracts.RunAsync(root); return; }
if (args.Contains("--server")) { await BackendServerContracts.RunAsync(root); return; }
if (args.Contains("--api-host")) { await ApiHostContracts.RunAsync(root); return; }
if (args.Contains("--production-host")) { await ApiHostContracts.RunAsync(root, true); return; }
if (args.Contains("--firebase-connection")) { await FirebaseConnectionContracts.RunAsync(root); return; }
if (args.Contains("--firebase-logout")) { await FirebaseLogoutContracts.RunAsync(); return; }
if (args.Contains("--inventory-retry")) { await InventoryTransactionContracts.RunAsync(); return; }
if (args.Contains("--backup"))
{
    await BackupContracts.RunAsync(root);
    if (args.Contains("--firestore-emulator")) await BackupContracts.EmulatorAsync(new Google.Cloud.Firestore.FirestoreDbBuilder
        { ProjectId = "demo-flowerflow-csharp", Endpoint = "127.0.0.1:8787", ChannelCredentials = Grpc.Core.ChannelCredentials.Insecure,
            Settings = new Google.Cloud.Firestore.V1.FirestoreSettings { CallSettings = Google.Api.Gax.Grpc.CallSettings.FromHeader("Authorization", "Bearer owner") } }.Build());
    return;
}
var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
start.ArgumentList.Add(Path.Combine(root, "flower.com/tests/UnitTests/FlowerFlow.Contracts/firebase-admin-oracle.cjs"));
using var process = Process.Start(start) ?? throw new Exception("Cannot start Node.js oracle.");
var outputTask = process.StandardOutput.ReadToEndAsync();
var errorTask = process.StandardError.ReadToEndAsync();
await process.WaitForExitAsync();
var output = await outputTask;
var errors = await errorTask;
Assert(process.ExitCode == 0, "JavaScript oracle failed: " + errors);
using var scenarios = JsonDocument.Parse(output);
var count = 0;
foreach (var input in scenarios.RootElement.EnumerateArray())
{
    var backend = new FakeBackend(input);
    var logger = new CaptureLogger();
    var service = new FirebaseAuthService(backend, logger);
    var context = new DefaultHttpContext();
    context.Request.Headers.Authorization = input.GetProperty("authorization").GetString();
    using var body = new MemoryStream();
    context.Response.Body = body;
    var identity = input.GetProperty("method").GetString() switch
    {
        "admin" => await service.VerifyAdminRequestAsync(context),
        "owner" => await service.VerifyOwnerRequestAsync(context),
        _ => await service.VerifyRequestAsync(context)
    };
    body.Position = 0;
    var bodyText = await new StreamReader(body).ReadToEndAsync();
    var actual = JsonSerializer.SerializeToNode(new
    {
        uid = identity?.Uid, status = context.Response.StatusCode,
        body = bodyText.Length == 0 ? null : JsonNode.Parse(bodyText),
        verifiedToken = backend.VerifiedToken, checkRevoked = backend.CheckRevoked, roleReads = backend.RoleReads
    });
    var expected = JsonNode.Parse(input.GetProperty("expected").GetRawText());
    Assert(JsonNode.DeepEquals(actual, expected), $"{input.GetProperty("name")}: expected {expected}; actual {actual}");
    Assert(!string.Join(" ", logger.Messages).Contains("sensitive-provider-detail"), "Provider details leaked into logs.");
    if (bodyText.Length > 0) Assert(context.Response.ContentType?.StartsWith("application/json") == true, "Wrong content type.");
    count++;
}

var previousJson = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");
var previousAccountFile = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_FILE");
var previousProject = Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID");
var previousEmulator = Environment.GetEnvironmentVariable("FIRESTORE_EMULATOR_HOST");
try
{
    Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_FILE", null);
    foreach (var json in new string?[] { null, "{invalid", "{}", "null" })
    {
        Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", json);
        using var backend = new FirebaseAdminService();
        try { backend.GetAdminAuth(); throw new Exception("Invalid config accepted."); }
        catch (FirebaseAdminConfigurationException error)
        {
            Assert(error.Code == "admin-api-not-configured", "Configuration error code mismatch.");
            Assert(error.InnerException is null, "Credential exception must be sanitized.");
        }
        count++;
    }

    // A temporary generated RSA key validates SDK construction only. Never persisted or sent to Firebase.
    using var rsa = RSA.Create(2048);
    Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", JsonSerializer.Serialize(new
    {
        type = "service_account", project_id = "demo-flowerflow-contracts",
        private_key_id = "test-key", private_key = rsa.ExportPkcs8PrivateKeyPem(),
        client_email = "test@demo-flowerflow-contracts.iam.gserviceaccount.com",
        client_id = "123456789", token_uri = "https://oauth2.googleapis.com/token"
    }));
    foreach (var projectOverride in new string?[] { null, "demo-flowerflow-override", "demo-flowerflow-emulator" })
    {
        Environment.SetEnvironmentVariable("FIREBASE_PROJECT_ID", projectOverride);
        Environment.SetEnvironmentVariable("FIRESTORE_EMULATOR_HOST",
            projectOverride == "demo-flowerflow-emulator" ? "127.0.0.1:18080" : null);
        using var backend = new FirebaseAdminService();
        var auth = backend.GetAdminAuth();
        var db = backend.GetAdminFirestore();
        Assert(ReferenceEquals(auth, backend.GetAdminAuth()), "Auth app not reused.");
        Assert(ReferenceEquals(db, backend.GetAdminFirestore()), "Firestore client not reused.");
        Assert(db.ProjectId == (projectOverride ?? "demo-flowerflow-contracts"), "Project selection mismatch.");
        count++;
    }
}
finally
{
    Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", previousJson);
    Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_FILE", previousAccountFile);
    Environment.SetEnvironmentVariable("FIREBASE_PROJECT_ID", previousProject);
    Environment.SetEnvironmentVariable("FIRESTORE_EMULATOR_HOST", previousEmulator);
}
Console.WriteLine($"PASS: {count} Firebase Admin contract/configuration scenarios; no live database operations.");
await AdditionalContracts.ImageRulesAsync(root);
await AdditionalContracts.ApiRoutesAsync(root);
await AdditionalContracts.IdentityAsync();
WiltingPriceContracts.Run();
HanoiDeliveryContracts.Run();
await SharedContracts.RunAsync(root);
AdditionalContracts.AdminAuditEntry();
await AdditionalContracts.VnpayAsync(root);
await AdditionalContracts.OrderValidationAsync(root);
await AdditionalContracts.PricingAsync(root);
await AdditionalContracts.TrackingAsync(root);
await AdditionalContracts.DesignValidationAsync(root);
await PasswordContracts.RunAsync();
await FirebaseLogoutContracts.RunAsync();
await InventoryTransactionContracts.RunAsync();
await AdditionalContracts.CheckoutFingerprintsAsync(root);
AdditionalContracts.LocalSessionCookies();
await AdditionalContracts.LocalRateLimitAsync(root);
await AdditionalContracts.ContentSecurityAsync(root);
await LocalAccountContracts.RunAsync(root);
await LocalWorkerContracts.RunAsync();
await LocalHttpContracts.RunAsync(root);
await BackupContracts.RunAsync(root);
await BackendServerContracts.RunAsync(root);
await ApiHostContracts.RunAsync(root);
await ApiHostContracts.RunAsync(root, true);
await FirebaseConnectionContracts.RunAsync(root);
if (args.Contains("--firestore-emulator")) await FirestoreContracts.RunAsync();

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

sealed class FakeBackend(JsonElement input) : IFirebaseAdminService
{
    public string? VerifiedToken { get; private set; }
    public bool? CheckRevoked { get; private set; }
    public int RoleReads { get; private set; }

    public Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken)
    {
        VerifiedToken = token;
        CheckRevoked = checkRevoked;
        if (Flag("tokenError")) throw new Exception("sensitive-provider-detail");
        var claims = input.GetProperty("claims").EnumerateObject().ToDictionary(property => property.Name,
            property => property.Value.ValueKind switch
            {
                JsonValueKind.True => (object)true,
                JsonValueKind.False => false,
                JsonValueKind.Number => property.Value.GetInt32(),
                _ => property.Value.GetString()!
            });
        return Task.FromResult(new FirebaseIdentity("user-a", claims));
    }

    public Task<AdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken)
    {
        if (uid != "user-a") throw new Exception("Wrong UID");
        RoleReads++;
        if (Flag("roleError")) throw new Exception("sensitive-provider-detail");
        return Task.FromResult(Flag("roleExists")
            ? new AdminRole(input.TryGetProperty("role", out var role) ? role.GetString() : null) : null);
    }

    private bool Flag(string key) => input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.True;
}

sealed class CaptureLogger : ILogger<FirebaseAuthService>
{
    public List<string> Messages { get; } = [];
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
}
