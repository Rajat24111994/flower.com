using System.Text.Json;
using System.Text.RegularExpressions;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;

namespace Flower.Api;

public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

// Lazy initialization preserves the Node API's 503 response when credentials are absent.
// The same project and existing collections are used; startup never writes to Firestore.
public sealed class FirebaseServices
{
    private readonly Lazy<(FirebaseAuth Auth, FirestoreDb Db)> services;
    public FirebaseServices(IConfiguration configuration)
    {
        services = new(() =>
        {
            try
            {
                var json = configuration["FIREBASE_SERVICE_ACCOUNT_JSON"];
                if (string.IsNullOrWhiteSpace(json)) throw new InvalidOperationException();
                using var document = JsonDocument.Parse(json);
                if (document.RootElement.GetProperty("type").GetString() != "service_account")
                    throw new InvalidOperationException();
                var project = configuration["FIREBASE_PROJECT_ID"] ?? document.RootElement.GetProperty("project_id").GetString();
                if (string.IsNullOrWhiteSpace(project)) throw new InvalidOperationException();
                var credential = CredentialFactory.FromJson<ServiceAccountCredential>(json).ToGoogleCredential();
                var app = FirebaseApp.Create(new AppOptions { Credential = credential, ProjectId = project }, "flower-aspnet");
                var emulator = configuration["FIRESTORE_EMULATOR_HOST"] != null || configuration["FIREBASE_AUTH_EMULATOR_HOST"] != null;
                if (emulator && (!project.StartsWith("demo-", StringComparison.Ordinal) || configuration["FIRESTORE_EMULATOR_HOST"] == null || configuration["FIREBASE_AUTH_EMULATOR_HOST"] == null))
                    throw new InvalidOperationException();
                var db = new FirestoreDbBuilder { ProjectId = project, Credential = credential, EmulatorDetection = Google.Api.Gax.EmulatorDetection.EmulatorOrProduction }.Build();
                return (FirebaseAuth.GetAuth(app), db);
            }
            catch
            {
                throw new ApiException(503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình.");
            }
        });
    }
    public FirebaseAuth Auth => services.Value.Auth;
    public FirestoreDb Db => services.Value.Db;

    public async Task<FirebaseToken> Verify(HttpContext context)
    {
        var auth = Auth;
        var match = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+(.+)$", RegexOptions.IgnoreCase);
        if (!match.Success)
            throw new ApiException(401, "unauthenticated", "Cần mã xác thực Firebase để thực hiện thao tác này.");
        try { return await auth.VerifyIdTokenAsync(match.Groups[1].Value, true, context.RequestAborted); }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw new ApiException(401, "unauthenticated", "Mã xác thực Firebase không hợp lệ, đã hết hạn hoặc đã bị thu hồi.");
        }
    }
}
