using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Api.Gax;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Firebase;

// Port of flower.com/backend/shared/firebase-admin.js only.
public sealed record FirebaseIdentity(string Uid, IReadOnlyDictionary<string, object> Claims);
public sealed record FirebaseAdminRole(string? Role);

public interface IFirebaseAdminBackend
{
    Task<FirebaseIdentity> VerifyIdTokenAsync(string token, bool checkRevoked, CancellationToken cancellationToken);
    Task<FirebaseAdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken);
}

public sealed class FirebaseAdminConfigurationException(string message)
    : Exception(message)
{
    public string Code => "admin-api-not-configured";
}

/// <summary>One server-owned Firebase app, shared by Auth and Firestore. No database writes on startup.</summary>
public sealed class FirebaseAdminBackend : IFirebaseAdminBackend, IDisposable
{
    private readonly object _gate = new();
    private FirebaseApp? _app;
    private FirestoreDb? _firestore;
    private GoogleCredential? _credential;
    private GoogleCredential? _identityCredential;
    private bool _disposed;

    private FirebaseApp GetAdminApp()
    {
        var json = FirebaseServiceAccount.ReadJson();

        string? accountProjectId;
        try
        {
            using var document = JsonDocument.Parse(json);
            accountProjectId = document.RootElement.TryGetProperty("project_id", out var project)
                ? project.GetString() : null;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            // Do not retain the parsing exception: it may contain credential data.
            throw new FirebaseAdminConfigurationException("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
        }

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_app is not null) return _app;
            try
            {
                // Accept a service account only; do not accept arbitrary credential types from JSON.
                using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
                var credential = ServiceAccountCredential.FromServiceAccountData(stream).ToGoogleCredential();
                var projectId = Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID");
                _app = FirebaseApp.Create(new AppOptions
                {
                    Credential = credential,
                    ProjectId = string.IsNullOrEmpty(projectId) ? accountProjectId : projectId
                }, "flowerflow-" + Guid.NewGuid().ToString("N"));
                _credential = credential;
                _identityCredential = credential.CreateScoped("https://www.googleapis.com/auth/identitytoolkit");
                return _app;
            }
            catch
            {
                throw new FirebaseAdminConfigurationException("Firebase Admin service account could not be initialized.");
            }
        }
    }

    public FirebaseAuth GetAdminAuth() => FirebaseAuth.GetAuth(GetAdminApp());
    public string ProjectId => GetAdminApp().Options.ProjectId;
    public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        GetAdminApp();
        return ((ITokenAccess)_identityCredential!).GetAccessTokenForRequestAsync(cancellationToken: cancellationToken);
    }

    public FirestoreDb GetAdminFirestore()
    {
        var app = GetAdminApp();
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return _firestore ??= new FirestoreDbBuilder
            {
                ProjectId = app.Options.ProjectId,
                GoogleCredential = _credential,
                EmulatorDetection = EmulatorDetection.EmulatorOrProduction
            }.Build();
        }
    }

    public async Task<FirebaseIdentity> VerifyIdTokenAsync(
        string token, bool checkRevoked, CancellationToken cancellationToken)
    {
        var decoded = await GetAdminAuth().VerifyIdTokenAsync(token, checkRevoked, cancellationToken);
        return new FirebaseIdentity(decoded.Uid, decoded.Claims);
    }

    public async Task<FirebaseAdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken)
    {
        var snapshot = await GetAdminFirestore().Collection("adminRoles").Document(uid)
            .GetSnapshotAsync(cancellationToken);
        if (!snapshot.Exists) return null;
        var data = snapshot.ToDictionary();
        return new FirebaseAdminRole(data.TryGetValue("role", out var role) ? role as string : null);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _app?.Delete();
        }
    }
}

/// <summary>Preserves the legacy helpers' error body, status and live-role checks.</summary>
public sealed class FirebaseAdminService(IFirebaseAdminBackend backend, ILogger<FirebaseAdminService> logger)
{
    // ECMAScript . excludes these four line terminators; keep the source regex semantics.
    private static readonly Regex Bearer = new(@"^Bearer\s+([^\r\n\u2028\u2029]+)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public static Task SendErrorAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { code, error = message }, context.RequestAborted);
    }

    public async Task<FirebaseIdentity?> VerifyRequestAsync(HttpContext context)
    {
        var match = Bearer.Match(context.Request.Headers.Authorization.ToString());
        if (!match.Success)
        {
            await SendErrorAsync(context, 401, "unauthenticated", "Cần mã xác thực Firebase để thực hiện thao tác này.");
            return null;
        }

        try
        {
            return await backend.VerifyIdTokenAsync(match.Groups[1].Value, true, context.RequestAborted);
        }
        catch
        {
            // Never log provider errors, bearer tokens or credentials.
            logger.LogError("Firebase ID token verification failed.");
            await SendErrorAsync(context, 401, "unauthenticated", "Mã xác thực Firebase không hợp lệ, đã hết hạn hoặc đã bị thu hồi.");
            return null;
        }
    }

    public Task<FirebaseIdentity?> VerifyAdminRequestAsync(HttpContext context) => VerifyRoleRequestAsync(context, false);
    public Task<FirebaseIdentity?> VerifyOwnerRequestAsync(HttpContext context) => VerifyRoleRequestAsync(context, true);

    private async Task<FirebaseIdentity?> VerifyRoleRequestAsync(HttpContext context, bool requireOwner)
    {
        var user = await VerifyRequestAsync(context);
        if (user is null) return null;
        if (!user.Claims.TryGetValue("admin", out var admin) || admin is not true)
        {
            await SendErrorAsync(context, 403, "permission-denied", "Bạn cần quyền quản trị viên để thực hiện thao tác này.");
            return null;
        }

        FirebaseAdminRole? role;
        try
        {
            role = await backend.GetAdminRoleAsync(user.Uid, context.RequestAborted);
        }
        catch
        {
            logger.LogError("Firebase admin role verification failed.");
            await SendErrorAsync(context, 503, "authorization-service-unavailable", "Chưa thể xác minh quyền quản trị.");
            return null;
        }

        if (role is null || (requireOwner &&
            (!user.Claims.TryGetValue("role", out var claimRole) || claimRole is not "owner" || role.Role != "owner")))
        {
            await SendErrorAsync(context, 403, "permission-denied", "Quyền quản trị viên đã bị thu hồi.");
            return null;
        }
        return user;
    }
}
