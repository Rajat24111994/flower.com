using System.Text;
using System.Text.Json;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Api.Gax;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Firebase;




/// <summary>One server-owned Firebase app, shared by Auth and Firestore. No database writes on startup.</summary>
public sealed class FirebaseAdminService : IFirebaseAdminService, IDisposable
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

    public async Task<AdminRole?> GetAdminRoleAsync(string uid, CancellationToken cancellationToken)
    {
        var snapshot = await GetAdminFirestore().Collection(AdminRole.Collection).Document(uid)
            .GetSnapshotAsync(cancellationToken);
        if (!snapshot.Exists) return null;
        var data = snapshot.ToDictionary();
        return new AdminRole(data.TryGetValue("role", out var role) ? role as string : null);
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

