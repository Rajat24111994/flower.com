namespace FlowerFlow.Application.Common.Configuration;

public static class FirebaseServiceAccount
{
    public static bool IsConfigured(Func<string, string?>? environment = null)
    {
        var read = environment ?? Environment.GetEnvironmentVariable;
        return !string.IsNullOrEmpty(read("FIREBASE_SERVICE_ACCOUNT_JSON")) || !string.IsNullOrWhiteSpace(read("FIREBASE_SERVICE_ACCOUNT_FILE"));
    }

    // Inline JSON retains precedence for existing deployments. Files are explicitly selected
    // server-side, then parsed as service accounts by FirebaseAdminBackend (never arbitrary ADC).
    public static string ReadJson(Func<string, string?>? environment = null)
    {
        var read = environment ?? Environment.GetEnvironmentVariable;
        var json = read("FIREBASE_SERVICE_ACCOUNT_JSON");
        if (!string.IsNullOrEmpty(json)) return json;
        var filename = read("FIREBASE_SERVICE_ACCOUNT_FILE");
        if (string.IsNullOrWhiteSpace(filename))
            throw new FirebaseAdminConfigurationException("Firebase Admin service account is not configured.");
        try { return File.ReadAllText(filename); }
        catch { throw new FirebaseAdminConfigurationException("Firebase Admin service account file could not be read."); }
    }
}

public sealed class FirebaseAdminConfigurationException(string message)
    : Exception(message)
{
    public string Code => "admin-api-not-configured";
}
