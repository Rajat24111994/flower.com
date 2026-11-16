using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

static class FirebaseConnectionContracts
{
    public static async Task RunAsync(string root)
    {
        var file = Path.Combine(Path.GetTempPath(), "flowerflow-firebase-" + Guid.NewGuid().ToString("N") + ".json");
        var values = new Dictionary<string, string?>();
        string? Read(string name) => values.GetValueOrDefault(name);
        try
        {
            AdditionalContracts.Require(!FirebaseServiceAccount.IsConfigured(Read), "Empty credentials treated as configured");
            values["FIREBASE_SERVICE_ACCOUNT_FILE"] = file;
            try { FirebaseServiceAccount.ReadJson(Read); throw new Exception("Missing service account file accepted"); }
            catch (FirebaseAdminConfigurationException error)
            { AdditionalContracts.Require(error.InnerException is null && !error.Message.Contains(file), "Credential path leaked in errors"); }
            await File.WriteAllTextAsync(file, "contract-secret-file");
            AdditionalContracts.Require(FirebaseServiceAccount.ReadJson(Read) == "contract-secret-file", "Credential file was not read");
            values["FIREBASE_SERVICE_ACCOUNT_JSON"] = "inline-config";
            AdditionalContracts.Require(FirebaseServiceAccount.ReadJson(Read) == "inline-config", "Existing inline credential precedence changed");

            async Task<JsonElement> Check(string? accountFile)
            {
                var start = new ProcessStartInfo("dotnet") { WorkingDirectory = root, RedirectStandardOutput = true, RedirectStandardError = true };
                start.ArgumentList.Add(Path.Combine(root, "flower.com/backend/FlowerFlow.Api/bin/Release/net10.0/FlowerFlow.Api.dll")); start.ArgumentList.Add("--check-firebase");
                foreach (var name in new[] { "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_FILE", "FIREBASE_PROJECT_ID", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "PORT", "FLOWER_FRONTEND_ROOT" }) start.Environment.Remove(name);
                start.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
                if (accountFile is not null) start.Environment["FIREBASE_SERVICE_ACCOUNT_FILE"] = accountFile;
                using var process = Process.Start(start)!; var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync(); var text = await output; var stderr = await errors;
                AdditionalContracts.Require(process.ExitCode == 1 && !text.Contains("PRIVATE KEY") && !stderr.Contains("PRIVATE KEY") && !text.Contains("contract-secret-file") && !stderr.Contains("contract-secret-file"), "Diagnostic leaked a key or incorrectly claimed a live connection");
                using var report = JsonDocument.Parse(text); return report.RootElement.Clone();
            }
            AdditionalContracts.Require((await Check(null)).GetProperty("code").GetString() == "firebase-credentials-missing", "Missing credentials not diagnosed");
            AdditionalContracts.Require((await Check(file)).GetProperty("code").GetString() == "firebase-credentials-invalid", "Invalid credentials not sanitized");
            using var rsa = RSA.Create(2048);
            await File.WriteAllTextAsync(file, JsonSerializer.Serialize(new { type = "service_account", project_id = "demo-connection-mismatch", private_key_id = "contract-key",
                private_key = rsa.ExportPkcs8PrivateKeyPem(), client_email = "contract@demo-connection-mismatch.iam.gserviceaccount.com", client_id = "123456789", token_uri = "https://oauth2.googleapis.com/token" }));
            AdditionalContracts.Require((await Check(file)).GetProperty("code").GetString() == "firebase-project-mismatch", "Diagnostic did not stop before contacting the wrong project");
        }
        finally { File.Delete(file); }
        Console.WriteLine("PASS: external credential file, inline precedence, sanitized configuration failures and read-only diagnostic project guard; no live Firebase calls.");
    }
}
