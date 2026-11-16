using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

static class LocalAccountContracts
{
    private static JsonNode? Clean(object? result)
    {
        if (result is null) return null;
        if (result is Dictionary<string, object> account) return JsonSerializer.SerializeToNode(account.Where(pair => pair.Key != "uid").ToDictionary());
        var value = (LocalAuthResult)result; var data = new Dictionary<string, object> { ["status"] = value.Status };
        if (value.Code is not null) data["code"] = value.Code;
        if (value.RetryAfter is not null) data["retryAfter"] = value.RetryAfter;
        if (value.AttemptsRemaining is not null) data["attemptsRemaining"] = value.AttemptsRemaining;
        if (value.Account is not null) data["account"] = value.Account.Where(pair => pair.Key != "uid").ToDictionary();
        if (value.SessionToken is not null) data["sessionToken"] = true;
        if (value.Questions is not null) data["questions"] = value.Questions;
        if (value.PinResetRequired) { data["pinResetRequired"] = true; data["pinResetReason"] = value.PinResetReason!; }
        return JsonSerializer.SerializeToNode(data);
    }
    private static async Task<JsonDocument> NodeAsync(string root, params string[] args)
    {
        var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(root,"flower.com/tests/UnitTests/FlowerFlow.Contracts/local-accounts-oracle.cjs"));
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start)!; var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync(); AdditionalContracts.Require(process.ExitCode == 0, "Local account Node oracle failed: " + await error);
        return JsonDocument.Parse(await output);
    }
    public static async Task RunAsync(string root)
    {
        using var cases = await NodeAsync(root); long now = 1700000000000; string? token = null;
        using (var accounts = new LocalAccounts(now: () => now))
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            now = test.GetProperty("now").GetInt64(); var method = test.GetProperty("method").GetString(); var body = test.GetProperty("body"); JsonNode? actual;
            try
            {
                if (method == "session") actual = Clean(accounts.Session(token));
                else if (method == "logout") { accounts.Logout(token is null ? [] : [token]); actual = new JsonObject(); }
                else
                {
                    var previous = token is null ? Array.Empty<string>() : [token];
                    var result = method switch { "register" => accounts.Register(body, previous), "login" => accounts.Login(body, previous), "questions" => accounts.Questions(body),
                        "reset" => accounts.Reset(body, previous), "recoverPin" => accounts.RecoverPin(body, previous), "changePin" => accounts.ChangePin(body, token), "setupSecurity" => accounts.SetupSecurity(body, token), _ => throw new Exception("Unknown test method") };
                    if (result.SessionToken is not null) token = result.SessionToken;
                    actual = Clean(result);
                }
            }
            catch (LocalAccountException error) { actual = JsonSerializer.SerializeToNode(new { status = error.Status, code = error.Code, error = error.Message }); }
            var expected = JsonNode.Parse(test.GetProperty("expected").GetRawText());
            AdditionalContracts.Require(JsonNode.DeepEquals(actual, expected), $"Local accounts {method} differs from Node: expected {expected}; got {actual}");
        }
        var directory = Path.Combine(Path.GetTempPath(), "flowerflow-accounts-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var filename = Path.Combine(directory, "accounts.sqlite");
        try
        {
            using var seed = await NodeAsync(root, filename, "seed"); var fixture = seed.RootElement;
            AdditionalContracts.Require(Convert.ToHexStringLower(LocalAccounts.PasswordHash("mật khẩu123", Enumerable.Repeat((byte)7,16).ToArray())) == fixture.GetProperty("passwordHash").GetString()
                && Convert.ToHexStringLower(LocalAccounts.SecretHash("câu trả lời", Enumerable.Repeat((byte)7,16).ToArray())) == fixture.GetProperty("secretHash").GetString(), "Node scrypt password/PIN/answer hashes changed");
            using (var accounts = new LocalAccounts(filename, () => 1700000000000))
            {
                var oldToken = fixture.GetProperty("token").GetString();
                AdditionalContracts.Require(accounts.Session(oldToken)?["uid"].ToString() == fixture.GetProperty("uid").GetString(), "Existing Node SQLite session lost");
                AdditionalContracts.Require(accounts.Login(fixture.GetProperty("input")).Status == 200, "Existing Node password cannot log in through C#");
                var reset = JsonNode.Parse(fixture.GetProperty("input").GetRawText())!; reset["newPassword"] = "moiMatkhau456";
                AdditionalContracts.Require(accounts.Reset(JsonSerializer.SerializeToElement(reset)).Status == 200 && accounts.Session(oldToken) is null, "Password reset did not revoke Node sessions");
            }
            using var verified = await NodeAsync(root, filename, "verify");
            AdditionalContracts.Require(verified.RootElement.GetProperty("status").GetInt32() == 200, "Node cannot read the C# password hash/session schema");
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = filename, Pooling = false }.ToString()))
            {
                db.Open(); using var command = db.CreateCommand();
                command.CommandText = "ALTER TABLE local_users DROP COLUMN pin_failures; ALTER TABLE local_users DROP COLUMN pin_reset_required; UPDATE local_users SET recovery_failures = 4"; command.ExecuteNonQuery();
            }
            var resetBody = JsonNode.Parse(fixture.GetProperty("input").GetRawText())!; resetBody["pin"] = "0000"; resetBody["newPassword"] = "anotherPassword789";
            using (var accounts = new LocalAccounts(filename, () => 1700000000000))
                AdditionalContracts.Require(accounts.Reset(JsonSerializer.SerializeToElement(resetBody)).Code == "pin-reset-required", "Legacy shared PIN failure budget was reset during migration");
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = filename, Pooling = false }.ToString()))
            {
                db.Open(); using var command = db.CreateCommand(); command.CommandText = "ALTER TABLE local_users DROP COLUMN pin_format_version"; command.ExecuteNonQuery();
            }
            using (var accounts = new LocalAccounts(filename, () => 1700000000000))
                AdditionalContracts.Require(accounts.Questions(fixture.GetProperty("input")).PinResetReason == "pin-format-update-required", "Old PIN format bypassed the required question recovery");
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = filename, Pooling = false }.ToString()))
            {
                db.Open(); using var command = db.CreateCommand(); command.CommandText = "UPDATE local_users SET pin_hash = NULL, pin_salt = NULL, security_questions = NULL, security_answers = NULL, recovery_failures = 0, recovery_locked_until = 0, pin_failures = 0, pin_reset_required = 0"; command.ExecuteNonQuery();
            }
            using (var accounts = new LocalAccounts(filename, () => 1700000000000))
            {
                var body = JsonNode.Parse(fixture.GetProperty("input").GetRawText())!; body["password"] = "moiMatkhau456";
                var login = accounts.Login(JsonSerializer.SerializeToElement(body));
                var enrolled = accounts.SetupSecurity(JsonSerializer.SerializeToElement(body), login.SessionToken);
                AdditionalContracts.Require(enrolled.Status == 200 && enrolled.Account!["securityConfigured"] is true && accounts.Session(login.SessionToken) is null,
                    "Legacy security enrollment lost data or failed to rotate sessions");
            }
        }
        finally { foreach (var file in Directory.EnumerateFiles(directory)) File.Delete(file); Directory.Delete(directory); }
        Console.WriteLine("PASS: local account workflows match Node; existing SQLite accounts/sessions and scrypt hashes interoperate in both directions.");
    }
}
