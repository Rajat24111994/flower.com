using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Accounts;
using Microsoft.Data.Sqlite;
using Org.BouncyCastle.Crypto.Generators;

namespace FlowerFlow.Infrastructure.Local;

public sealed class LocalAccountException(string code, string message, int status = 400) : Exception(message)
{ public string Code { get; } = code; public int Status { get; } = status; }

public sealed record LocalAuthResult(int Status = 200, string? Code = null, int? RetryAfter = null, int? AttemptsRemaining = null,
    Dictionary<string, object>? Account = null, string? SessionToken = null, string[]? Questions = null,
    bool PinResetRequired = false, string? PinResetReason = null);

// Port of lib/local-accounts.js. SQLite is exclusively the existing local-development account store.
// Production customer authentication and application data continue to use Firebase/Firestore.
public sealed class LocalAccounts : IDisposable
{
    private readonly SqliteConnection _db;
    private readonly Func<long> _now;
    private readonly object _gate = new();
    private readonly byte[] _dummySalt = RandomNumberGenerator.GetBytes(16);
    private readonly byte[] _dummyHash;
    private const string PasswordMessage = "Mật khẩu cần từ 8 đến 4096 ký tự, có chữ thường (a–z) và số (0–9).";
    private const string Space = @"[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]";
    private static string Trim(string value) => Regex.Replace(value, "^" + Space + "+|" + Space + "+$", "");
    private static string Normalize(string value) => Regex.Replace(Trim(value.Normalize(NormalizationForm.FormKC)), Space + "+", " ").ToLowerInvariant();
    private static string? Text(JsonElement input, string key) => Js.Get(input, key) is var value && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static bool Match(string value, string pattern) => Regex.IsMatch(value, pattern, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static string Digest(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static byte[] PasswordHash(string value, byte[] salt) => SCrypt.Generate(Encoding.UTF8.GetBytes(value), salt, 32768, 8, 1, 32);
    public static byte[] SecretHash(string value, byte[] salt) => SCrypt.Generate(Encoding.UTF8.GetBytes(value), salt, 32768, 8, 3, 32);
    private static bool Same(byte[] a, byte[] b) => a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    private static string Username(JsonElement input)
    {
        var value = Trim(Text(input, "email") ?? "").ToLowerInvariant();
        if (value.Length > 254 || !Match(value, "^[^" + Space[1..^1] + "@]+@[^" + Space[1..^1] + "@]+\\z"))
            throw new LocalAccountException("invalid-username", "Tên đăng nhập cần có @, ví dụ ban@demo.");
        return value;
    }
    private static string Password(JsonElement input, string key = "password", int minimum = 8)
    {
        var value = Text(input, key);
        if (value is null || value.Length < minimum || value.Length > 4096 || (minimum == 8 && (!Match(value, "[a-z]") || !Match(value, "[0-9]"))))
            throw new LocalAccountException("invalid-password", minimum == 8 ? PasswordMessage : "Vui lòng nhập mật khẩu.");
        return value;
    }
    private static string Pin(JsonElement input, string key)
    {
        var value = Text(input, key);
        if (value is null || !Match(value, @"\A[0-9]{4,6}\z")) throw new LocalAccountException("invalid-pin", "PIN chỉ được gồm 4 đến 6 chữ số (0–9).");
        return value;
    }
    private static string NewPin(JsonElement input)
    {
        var value = Pin(input, Js.Get(input, "newPin").ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "pin" : "newPin");
        if (value != Text(input, "confirmPin")) throw new LocalAccountException("pin-mismatch", "PIN xác nhận không khớp.");
        if (value == Text(input, "password") || value == Text(input, "newPassword")) throw new LocalAccountException("pin-matches-password", "Hãy đặt PIN khác mật khẩu.");
        return value;
    }
    private static (string Name, string Phone) Profile(JsonElement input)
    {
        var name = Trim(Text(input, "name") ?? ""); var phone = Trim(Text(input, "phone") ?? "");
        if (name.Length is 0 or > 120 || phone.Length is 0 or > 30) throw new LocalAccountException("invalid-profile", "Vui lòng nhập đầy đủ họ tên và số điện thoại (tối đa 120 và 30 ký tự).");
        return (name, phone);
    }
    private static (string Titles, string Answers) SecurityQuestions(JsonElement input)
    {
        var questions = Js.Get(input, "questions");
        if (questions.ValueKind != JsonValueKind.Array || questions.GetArrayLength() != 3)
            throw new LocalAccountException("invalid-security-questions", "Hãy đặt 3 câu hỏi khác nhau và trả lời đủ cả 3 câu.");
        var titles = new List<string>(); var normalized = new List<string>();
        foreach (var item in questions.EnumerateArray())
        {
            var title = Trim(Text(item, "question") ?? ""); var answer = Normalize(Text(item, "answer") ?? "");
            if (title.Length is < 5 or > 160 || answer.Length is < 6 or > 200 || titles.Any(other => Normalize(other) == Normalize(title)) || normalized.Contains(answer)
                || new[] { "email", "name", "phone", "password", "pin", "newPin" }.Any(key => Text(input, key) is { } value && Normalize(value) == answer)
                || Match(answer, @"^(.)\1+$|^(?:123456[0-9]*|abcdef[A-Za-z0-9_]*|qwerty[A-Za-z0-9_]*|password[A-Za-z0-9_]*|mat khau|mật khẩu|khong biet|không biết|khong co|không có|[0-9]+)$"))
                throw new LocalAccountException("invalid-security-questions", "Đặt 3 câu hỏi khác nhau; đáp án cần 6–200 ký tự, khó đoán, không chỉ gồm số và không trùng nhau.");
            titles.Add(title); normalized.Add(answer);
        }
        var answers = normalized.Select(answer => { var salt = RandomNumberGenerator.GetBytes(16); return new { salt = Convert.ToHexStringLower(salt), hash = Convert.ToHexStringLower(SecretHash(answer, salt)) }; });
        return (JsonSerializer.Serialize(titles), JsonSerializer.Serialize(answers));
    }
    public LocalAccounts(string filename = ":memory:", Func<long>? now = null)
    {
        _now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (filename != ":memory:")
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(filename))!;
            if (OperatingSystem.IsWindows()) Directory.CreateDirectory(directory);
            else Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        _db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = filename, Pooling = false }.ToString()); _db.Open();
        try
        {
            Execute("""
                PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS local_users (
                    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
                    password_hash BLOB NOT NULL, salt BLOB NOT NULL, recovery_hash TEXT NOT NULL,
                    failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
                    reset_required INTEGER NOT NULL DEFAULT 0, recovery_failures INTEGER NOT NULL DEFAULT 0,
                    recovery_locked_until INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS local_sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL);
                """);
            Transaction(() =>
            {
                var columns = Rows("PRAGMA table_info(local_users)").Select(row => S(row, "name")).ToHashSet(StringComparer.Ordinal);
                var additions = new Dictionary<string, string> { ["pin_hash"] = "BLOB", ["pin_salt"] = "BLOB", ["security_questions"] = "TEXT", ["security_answers"] = "TEXT",
                    ["answer_failures"] = "INTEGER NOT NULL DEFAULT 0", ["answer_locked_until"] = "INTEGER NOT NULL DEFAULT 0", ["pin_failures"] = "INTEGER NOT NULL DEFAULT 0",
                    ["pin_reset_required"] = "INTEGER NOT NULL DEFAULT 0", ["pin_format_version"] = "INTEGER NOT NULL DEFAULT 1" };
                foreach (var column in additions) if (!columns.Contains(column.Key)) Execute($"ALTER TABLE local_users ADD COLUMN {column.Key} {column.Value}");
                if (!columns.Contains("pin_failures")) Execute("UPDATE local_users SET pin_failures = MIN(5, recovery_failures), pin_reset_required = CASE WHEN recovery_failures >= 5 THEN 1 ELSE 0 END, recovery_failures = 0, recovery_locked_until = 0 WHERE pin_hash IS NOT NULL");
                return 0;
            });
            _dummyHash = PasswordHash(Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)), _dummySalt);
        }
        catch { _db.Dispose(); throw; }
    }
    private SqliteCommand Command(string sql, params object?[] values)
    {
        var command = _db.CreateCommand();
        // Existing SQL uses positional question marks; bind each to a unique named parameter.
        var index = 0; command.CommandText = Regex.Replace(sql, @"\?", _ => "$p" + index++);
        for (var i = 0; i < values.Length; i++) command.Parameters.AddWithValue("$p" + i, values[i] ?? DBNull.Value);
        return command;
    }
    private void Execute(string sql, params object?[] values) { using var command = Command(sql, values); command.ExecuteNonQuery(); }
    private List<Dictionary<string, object>> Rows(string sql, params object?[] values)
    {
        using var command = Command(sql, values); using var reader = command.ExecuteReader(); var rows = new List<Dictionary<string, object>>();
        while (reader.Read()) { var row = new Dictionary<string, object>(StringComparer.Ordinal); for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null! : reader.GetValue(i); rows.Add(row); }
        return rows;
    }
    private T Transaction<T>(Func<T> action)
    {
        lock (_gate) { Execute("BEGIN IMMEDIATE"); try { var result = action(); Execute("COMMIT"); return result; } catch { Execute("ROLLBACK"); throw; } }
    }
    private Dictionary<string, object>? User(string email) => Rows("SELECT * FROM local_users WHERE username = ?", email).FirstOrDefault();
    private static string S(Dictionary<string, object> row, string key) => row.GetValueOrDefault(key) as string ?? "";
    private static long N(Dictionary<string, object> row, string key) => Convert.ToInt64(row.GetValueOrDefault(key) ?? 0, CultureInfo.InvariantCulture);
    private static byte[] B(Dictionary<string, object> row, string key) => row.GetValueOrDefault(key) as byte[] ?? [];
    private static bool HasPin(Dictionary<string, object> row) => row.GetValueOrDefault("pin_hash") is byte[];
    private static bool VerifyPin(Dictionary<string, object> row, string value) => Same(SecretHash(value, B(row, "pin_salt")), B(row, "pin_hash"));
    private static Dictionary<string, object> PublicAccount(Dictionary<string, object> row) => new()
    {
        ["uid"] = S(row, "id"), ["email"] = S(row, "username"), ["name"] = S(row, "name") is { Length: > 0 } name ? name : "Khách hàng", ["phone"] = S(row, "phone"),
        ["role"] = "customer", ["authProvider"] = "local", ["securityConfigured"] = HasPin(row) && S(row, "security_answers").Length > 0,
        ["pinResetRequired"] = N(row, "pin_reset_required") != 0 || (HasPin(row) && N(row, "pin_format_version") < 2), ["sessionExpiresAt"] = N(row, "session_expires_at")
    };
    private static bool ValidToken(string? token) => token is not null && Match(token, @"\A[A-Za-z0-9_-]{43}\z");
    private void RemovePresented(IEnumerable<string>? tokens)
    { foreach (var token in (tokens ?? []).Distinct(StringComparer.Ordinal)) if (ValidToken(token)) Execute("DELETE FROM local_sessions WHERE token_hash = ?", Digest(token)); }
    private LocalAuthResult Authenticated(Dictionary<string, object> user, IEnumerable<string>? previous = null)
    {
        var time = _now(); var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var accountRow = new Dictionary<string, object>(user) { ["session_expires_at"] = time + LocalSession.SessionMs };
        Execute("DELETE FROM local_sessions WHERE expires_at <= ?", time); RemovePresented(previous);
        Execute("INSERT INTO local_sessions VALUES (?, ?, ?)", Digest(token), user["id"], time + LocalSession.SessionMs);
        return new(Account: PublicAccount(accountRow), SessionToken: token);
    }
    private Dictionary<string, object>? SessionUser(string? token) => !ValidToken(token) ? null : Rows("SELECT u.*, s.expires_at AS session_expires_at FROM local_sessions s JOIN local_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?", Digest(token!), _now()).FirstOrDefault();
    private LocalAuthResult? Blocked(Dictionary<string, object> user, string kind = "recovery") => N(user, kind + "_locked_until") > _now()
        ? new(429, kind == "answer" ? "answers-locked" : "recovery-locked", (int)Math.Ceiling((N(user, kind + "_locked_until") - _now()) / 1000d), 0) : null;
    private LocalAuthResult Failed(Dictionary<string, object> user, string code, string kind = "recovery")
    {
        var count = N(user, kind + "_locked_until") != 0 ? 1 : N(user, kind + "_failures") + 1; var until = count >= 5 ? _now() + 900_000 : 0;
        Execute($"UPDATE local_users SET {kind}_failures = ?, {kind}_locked_until = ? WHERE id = ?", count, until, user["id"]);
        return until != 0 ? new(429, kind == "answer" ? "answers-locked" : "recovery-locked", 900, 0) : new(401, code, AttemptsRemaining: (int)(5 - count));
    }
    private static LocalAuthResult? PinRestriction(Dictionary<string, object> user) => HasPin(user) && N(user, "pin_format_version") < 2 ? new(403, "pin-format-update-required")
        : N(user, "pin_reset_required") != 0 || N(user, "pin_failures") >= 5 ? new(403, "pin-reset-required", AttemptsRemaining: 0) : null;
    private LocalAuthResult FailedPin(Dictionary<string, object> user, string code)
    {
        var failures = Math.Min(5, N(user, "pin_failures") + 1);
        Execute("UPDATE local_users SET pin_failures = ?, pin_reset_required = ? WHERE id = ?", failures, failures >= 5 ? 1 : 0, user["id"]);
        return failures >= 5 ? new(403, "pin-reset-required", AttemptsRemaining: 0) : new(401, code, AttemptsRemaining: (int)(5 - failures));
    }
    private LocalAuthResult RotateSession(Dictionary<string, object> user) { Execute("DELETE FROM local_sessions WHERE user_id = ?", user["id"]); return Authenticated(user); }
    private Dictionary<string, object>? RecoveryUser(JsonElement input)
    {
        var user = User(Username(input)); var rawName = Text(input, "name"); var rawPhone = Text(input, "phone");
        var name = rawName is { Length: <= 120 } ? Normalize(rawName) : ""; var phone = rawPhone is { Length: <= 30 } ? Trim(rawPhone) : "";
        return user is not null && name.Length > 0 && phone.Length > 0 && name == Normalize(S(user, "name")) && phone == S(user, "phone") ? user : null;
    }
    public LocalAuthResult Register(JsonElement input, IEnumerable<string>? previous = null)
    {
        lock (_gate)
        {
            var email = Username(input); var secret = Password(input); var profile = Profile(input);
            if (User(email) is not null) throw new LocalAccountException("account-exists", "Tên đăng nhập này đã được sử dụng.", 409);
            var pin = NewPin(input); var questions = SecurityQuestions(input);
            return Transaction(() =>
            {
                if (User(email) is not null) throw new LocalAccountException("account-exists", "Tên đăng nhập này đã được sử dụng.", 409);
                var salt = RandomNumberGenerator.GetBytes(16); var pinSalt = RandomNumberGenerator.GetBytes(16);
                Execute("INSERT INTO local_users (id, username, name, phone, password_hash, salt, recovery_hash, pin_hash, pin_salt, security_questions, security_answers, pin_format_version) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 2)",
                    "local-" + Guid.NewGuid(), email, profile.Name, profile.Phone, PasswordHash(secret, salt), salt, SecretHash(pin, pinSalt), pinSalt, questions.Titles, questions.Answers);
                return Authenticated(User(email)!, previous);
            });
        }
    }
    private static LocalAuthResult? Restriction(Dictionary<string, object> state, long now)
    { var result = LoginProtection.Restriction(state, now); return result is null ? null : new(result.Status, result.Code, result.RetryAfter); }
    public LocalAuthResult Login(JsonElement input, IEnumerable<string>? previous = null)
    {
        var email = Username(input); var secret = Password(input, minimum: 1);
        return Transaction(() =>
        {
            var user = User(email);
            if (user is null) { Same(PasswordHash(secret, _dummySalt), _dummyHash); return new(401, "invalid-credential"); }
            var state = new Dictionary<string, object> { ["failures"] = N(user, "failures"), ["lockedUntil"] = N(user, "locked_until"), ["resetRequired"] = N(user, "reset_required") != 0 };
            var stop = Restriction(state, _now()); if (stop is not null) return stop;
            if (!Same(PasswordHash(secret, B(user, "salt")), B(user, "password_hash")))
            {
                var next = LoginProtection.FailureState(state, _now());
                Execute("UPDATE local_users SET failures = ?, locked_until = ?, reset_required = ? WHERE id = ?", next["failures"], next["lockedUntil"], next["resetRequired"] is true ? 1 : 0, user["id"]);
                return Restriction(next, _now()) ?? new(401, "invalid-credential");
            }
            Execute("UPDATE local_users SET failures = 0, locked_until = 0, reset_required = 0 WHERE id = ?", user["id"]);
            return Authenticated(user, previous);
        });
    }
    public LocalAuthResult Reset(JsonElement input, IEnumerable<string>? previous = null)
    {
        _ = Username(input); var secret = Password(input, "newPassword"); var hasPin = Js.Get(input, "pin").ValueKind != JsonValueKind.Undefined;
        if (hasPin) _ = Pin(input, "pin");
        else if (Text(input, "recoveryCode") is not { Length: > 0 and <= 128 }) throw new LocalAccountException("invalid-pin", "Vui lòng nhập PIN của tài khoản.");
        return Transaction(() =>
        {
            var user = RecoveryUser(input); if (user is null) return new(401, "invalid-recovery");
            var stop = PinRestriction(user) ?? Blocked(user); if (stop is not null) return stop;
            var legacy = Regex.Replace(Text(input, "recoveryCode") ?? "", Space + "|-", "").ToUpperInvariant();
            var verified = HasPin(user) ? hasPin && VerifyPin(user, Text(input, "pin")!) : !hasPin && S(user, "recovery_hash").Length > 0 && Same(Convert.FromHexString(Digest(legacy)), Convert.FromHexString(S(user, "recovery_hash")));
            if (!verified) return HasPin(user) ? FailedPin(user, "invalid-recovery") : Failed(user, "invalid-recovery");
            if (Same(PasswordHash(secret, B(user, "salt")), B(user, "password_hash"))) throw new LocalAccountException("password-unchanged", "Hãy chọn mật khẩu mới khác mật khẩu cũ.");
            if (HasPin(user) && VerifyPin(user, secret)) throw new LocalAccountException("pin-matches-password", "Hãy đặt mật khẩu khác PIN.");
            var salt = RandomNumberGenerator.GetBytes(16);
            Execute("UPDATE local_users SET password_hash = ?, salt = ?, recovery_hash = '', failures = 0, locked_until = 0, reset_required = 0, recovery_failures = 0, recovery_locked_until = 0, pin_failures = 0 WHERE id = ?", PasswordHash(secret, salt), salt, user["id"]);
            Execute("DELETE FROM local_sessions WHERE user_id = ?", user["id"]); RemovePresented(previous); return new();
        });
    }
    public LocalAuthResult Questions(JsonElement input)
    {
        lock (_gate)
        {
            var user = RecoveryUser(input); if (user is null) return new(401, "invalid-recovery");
            if (S(user, "security_questions").Length == 0) return new(409, "security-setup-required");
            var restriction = PinRestriction(user);
            return Blocked(user, "answer") ?? new(Questions: JsonSerializer.Deserialize<string[]>(S(user, "security_questions")), PinResetRequired: restriction is not null, PinResetReason: restriction?.Code);
        }
    }
    public LocalAuthResult RecoverPin(JsonElement input, IEnumerable<string>? previous = null)
    {
        _ = Username(input); var pin = NewPin(input); var answers = Js.Get(input, "answers");
        if (answers.ValueKind != JsonValueKind.Array || answers.GetArrayLength() != 3 || answers.EnumerateArray().Any(answer => answer.ValueKind != JsonValueKind.String || Normalize(answer.GetString()!).Length < 2 || answer.GetString()!.Length > 200))
            throw new LocalAccountException("invalid-answers", "Vui lòng trả lời đủ cả 3 câu hỏi (2–200 ký tự mỗi câu).");
        return Transaction(() =>
        {
            var user = RecoveryUser(input); if (user is null) return new(401, "invalid-recovery");
            if (S(user, "security_answers").Length == 0) return new(409, "security-setup-required");
            var stop = Blocked(user, "answer"); if (stop is not null) return stop;
            using var proofs = JsonDocument.Parse(S(user, "security_answers")); var correct = true; var index = 0;
            foreach (var proof in proofs.RootElement.EnumerateArray()) { correct &= Same(SecretHash(Normalize(answers[index++].GetString()!), Convert.FromHexString(proof.GetProperty("salt").GetString()!)), Convert.FromHexString(proof.GetProperty("hash").GetString()!)); }
            if (!correct) return Failed(user, "invalid-answers", "answer");
            if (VerifyPin(user, pin)) throw new LocalAccountException("pin-unchanged", "Hãy chọn PIN mới khác PIN cũ.");
            if (Same(PasswordHash(pin, B(user, "salt")), B(user, "password_hash"))) throw new LocalAccountException("pin-matches-password", "Hãy đặt PIN khác mật khẩu.");
            var salt = RandomNumberGenerator.GetBytes(16);
            Execute("UPDATE local_users SET pin_hash = ?, pin_salt = ?, recovery_hash = '', recovery_failures = 0, recovery_locked_until = 0, answer_failures = 0, answer_locked_until = 0, pin_failures = 0, pin_reset_required = 0, pin_format_version = 2 WHERE id = ?", SecretHash(pin, salt), salt, user["id"]);
            Execute("DELETE FROM local_sessions WHERE user_id = ?", user["id"]); RemovePresented(previous); return new();
        });
    }
    public LocalAuthResult ChangePin(JsonElement input, string? token)
    {
        var email = Username(input); var profile = Profile(input); var password = Password(input, minimum: 1); var oldPin = Pin(input, "oldPin"); var pin = NewPin(input);
        return Transaction(() =>
        {
            var user = SessionUser(token); if (user is null) return new(401, "session-required");
            if (!HasPin(user)) return new(409, "security-setup-required");
            var stop = PinRestriction(user) ?? Blocked(user); if (stop is not null) return stop;
            var passwordOk = Same(PasswordHash(password, B(user, "salt")), B(user, "password_hash")); var pinOk = VerifyPin(user, oldPin);
            if (!pinOk) return FailedPin(user, "invalid-security-proof");
            if (!passwordOk || S(user, "username") != email || Normalize(profile.Name) != Normalize(S(user, "name")) || profile.Phone != S(user, "phone")) return Failed(user, "invalid-security-proof");
            if (pin == oldPin) throw new LocalAccountException("pin-unchanged", "Hãy chọn PIN mới khác PIN cũ.");
            var salt = RandomNumberGenerator.GetBytes(16);
            Execute("UPDATE local_users SET pin_hash = ?, pin_salt = ?, recovery_hash = '', recovery_failures = 0, recovery_locked_until = 0, pin_failures = 0 WHERE id = ?", SecretHash(pin, salt), salt, user["id"]);
            return RotateSession(User(email)!);
        });
    }
    public LocalAuthResult SetupSecurity(JsonElement input, string? token)
    {
        var profile = Profile(input); var password = Password(input, minimum: 1); var pin = NewPin(input);
        return Transaction(() =>
        {
            var user = SessionUser(token); if (user is null) return new(401, "session-required");
            if (HasPin(user)) return new(409, "security-already-configured");
            var stop = Blocked(user); if (stop is not null) return stop;
            if (!Same(PasswordHash(password, B(user, "salt")), B(user, "password_hash"))) return Failed(user, "invalid-security-proof");
            var questions = SecurityQuestions(input); var salt = RandomNumberGenerator.GetBytes(16);
            Execute("UPDATE local_users SET name = ?, phone = ?, pin_hash = ?, pin_salt = ?, recovery_hash = '', security_questions = ?, security_answers = ?, recovery_failures = 0, recovery_locked_until = 0, pin_format_version = 2 WHERE id = ?", profile.Name, profile.Phone, SecretHash(pin, salt), salt, questions.Titles, questions.Answers, user["id"]);
            return RotateSession(User(S(user, "username"))!);
        });
    }
    public Dictionary<string, object>? Session(string? token) { lock (_gate) { var user = SessionUser(token); return user is null ? null : PublicAccount(user); } }
    public void Logout(IEnumerable<string>? tokens) => Transaction(() => { RemovePresented(tokens); return 0; });
    public void Dispose() { lock (_gate) _db.Dispose(); }
}
