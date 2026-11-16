using Google.Cloud.Firestore;

namespace FlowerFlow.Application.Accounts;

public sealed record LoginProtectionResult(int Status = 0, string? Code = null, int? RetryAfter = null,
    DocumentReference? Ref = null, string? LeaseId = null);

/// <summary>Port of accounts/login-protection.js. Provider calls must remain outside these transactions.</summary>
public sealed class LoginProtectionService(FirestoreDb db, Func<long>? clock = null, Func<string>? uuid = null)
{
    public const int InitialAttempts = 5;
    public static IReadOnlyList<int> LockMinutes { get; } = Array.AsReadOnly(new[] { 15, 30, 60, 120, 240 });
    public const int LeaseMs = 60_000;
    private readonly Func<long> _now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    private readonly Func<string> _uuid = uuid ?? (() => Guid.NewGuid().ToString());

    public static Dictionary<string, object> EmptyState(double passwordUpdatedAt = 0) => new()
    {
        ["failures"] = 0, ["lockedUntil"] = 0, ["resetRequired"] = false, ["passwordUpdatedAt"] = passwordUpdatedAt
    };

    public static Dictionary<string, object> FailureState(IDictionary<string, object> state, long now)
    {
        var failures = Number(state, "failures") + 1;
        var cycle = failures - InitialAttempts;
        return new Dictionary<string, object>(state)
        {
            ["failures"] = failures,
            ["lockedUntil"] = cycle >= 0 && cycle < LockMinutes.Count ? now + LockMinutes[(int)cycle] * 60_000L : 0L,
            ["resetRequired"] = cycle >= LockMinutes.Count
        };
    }

    public static LoginProtectionResult? Restriction(IDictionary<string, object> state, long now)
    {
        if (state.TryGetValue("resetRequired", out var reset) && reset is true)
            return new(403, "password-reset-required");
        var lockedUntil = Number(state, "lockedUntil");
        return lockedUntil > now ? new(429, "account-locked", (int)Math.Ceiling((lockedUntil - now) / 1000)) : null;
    }

    public Task<LoginProtectionResult> AcquireAsync(string accountKey, double passwordUpdatedAt,
        CancellationToken cancellationToken = default)
    {
        var reference = db.Collection(FirestoreCollections.LoginProtection).Document(accountKey);
        var leaseId = _uuid();
        return db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(reference, cancellationToken);
            var record = snapshot.Exists ? snapshot.ToDictionary() : EmptyState(passwordUpdatedAt);
            var now = _now();
            if (Number(record, "leaseUntil") > now) return new LoginProtectionResult(409, "login-in-progress", 1);
            var state = passwordUpdatedAt > Number(record, "passwordUpdatedAt") ? EmptyState(passwordUpdatedAt) : record;
            var blocked = Restriction(state, now);
            if (blocked is not null) return blocked;
            transaction.SetJs(reference, new Dictionary<string, object>(state)
            {
                ["passwordUpdatedAt"] = Math.Max(passwordUpdatedAt, Number(state, "passwordUpdatedAt")),
                ["leaseId"] = leaseId, ["leaseUntil"] = now + LeaseMs, ["updatedAt"] = now
            });
            return new LoginProtectionResult(Ref: reference, LeaseId: leaseId);
        }, cancellationToken: cancellationToken);
    }

    public Task<LoginProtectionResult> FinishAsync(LoginProtectionResult attempt, LoginOutcome outcome,
        CancellationToken cancellationToken = default) => db.RunTransactionAsync(async transaction =>
    {
        var snapshot = await transaction.GetSnapshotAsync(attempt.Ref!, cancellationToken);
        var record = snapshot.Exists ? snapshot.ToDictionary() : null;
        var now = _now();
        if (record is null || !record.TryGetValue("leaseId", out var id) || id as string != attempt.LeaseId
            || Number(record, "leaseUntil") <= now) return new LoginProtectionResult(503, "auth-service-unavailable");
        if (outcome == LoginOutcome.Success)
        {
            transaction.Delete(attempt.Ref!);
            return new LoginProtectionResult(200);
        }
        var state = outcome == LoginOutcome.Invalid ? FailureState(record, now) : record;
        transaction.SetJs(attempt.Ref!, new Dictionary<string, object>(state)
        {
            ["leaseId"] = "", ["leaseUntil"] = 0, ["updatedAt"] = now
        });
        return Restriction(state, now) ?? new LoginProtectionResult(401, "invalid-credential");
    }, cancellationToken: cancellationToken);

    private static double Number(IDictionary<string, object> state, string key) =>
        state.TryGetValue(key, out var value) && value is not null ? Convert.ToDouble(value, System.Globalization.CultureInfo.InvariantCulture) : 0;
}
