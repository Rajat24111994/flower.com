using System.Text.Json;
using System.Text.RegularExpressions;
using FirebaseAdmin.Auth;

namespace FlowerFlow.Api;

public static class FirebaseConnectionCheck
{
    // Console-only diagnostic: no new HTTP endpoint and no writes or test accounts.
    public static async Task<int> RunAsync(FirebaseAdminService backend, string frontendConfig, TextWriter output)
    {
        string? projectId = null; var authentication = false; var firestore = false;
        async Task<int> Report(string status, string? code = null)
        {
            await output.WriteLineAsync(JsonSerializer.Serialize(new { status, code, projectId, authentication, firestore }));
            return status == "connected" ? 0 : 1;
        }
        if (!FirebaseServiceAccount.IsConfigured()) return await Report("not-configured", "firebase-credentials-missing");
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FIRESTORE_EMULATOR_HOST"))
            || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FIREBASE_AUTH_EMULATOR_HOST")))
            return await Report("not-checked", "emulator-configured");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            var configuredProject = backend.ProjectId;
            var expected = Regex.Match(File.ReadAllText(frontendConfig), "projectId\\s*:\\s*\"([^\"]+)\"");
            if (!expected.Success || expected.Groups[1].Value != configuredProject)
                return await Report("not-checked", "firebase-project-mismatch");
            projectId = configuredProject;
            try { await backend.GetAdminAuth().GetUserAsync("connection-check-" + Guid.NewGuid().ToString("N"), timeout.Token); }
            catch (FirebaseAuthException error) when (error.AuthErrorCode == AuthErrorCode.UserNotFound) { }
            authentication = true;
            // Existing settings document; absence still proves a successful authorized read.
            await backend.GetAdminFirestore().Collection(FirestoreCollections.Metadata).Document("bouquetWrapping").GetSnapshotAsync(timeout.Token);
            firestore = true;
            return await Report("connected");
        }
        catch (FirebaseAdminConfigurationException) { return await Report("not-configured", "firebase-credentials-invalid"); }
        catch (OperationCanceledException) { return await Report("failed", "firebase-connection-timeout"); }
        catch { return await Report("failed", "firebase-connection-failed"); }
    }
}
