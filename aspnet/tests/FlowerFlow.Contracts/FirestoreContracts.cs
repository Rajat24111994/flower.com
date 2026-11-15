using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Grpc.Core;
using FlowerFlow.Infrastructure.Accounts;

static class FirestoreContracts
{
    public static async Task RunAsync()
    {
        // Explicit local endpoint and fixed demo project: never uses ADC or a production database.
        var db = new FirestoreDbBuilder
        {
            ProjectId = "demo-flowerflow-csharp", Endpoint = "127.0.0.1:8787",
            ChannelCredentials = ChannelCredentials.Insecure
        }.Build();
        var actor = new FirebaseIdentity("audit-tester", new Dictionary<string, object> { ["email"] = "tester@example.invalid" });
        var details = new Dictionary<string, object> { ["before"] = 1, ["after"] = 2 };
        var separate = await AdminAudit.RecordAdminAuditAsync(db, actor, "test.separate", "test", "item", details);
        var entry = await separate.GetSnapshotAsync();
        AdditionalContracts.Require(entry.GetValue<Timestamp>("createdAt").ToDateTime() > DateTime.UnixEpoch
            && entry.GetValue<string>("actorUid") == actor.Uid, "Audit server timestamp/actor not persisted");
        var item = db.Collection("contractTestItems").Document();
        DocumentReference? audit = null;
        await db.RunTransactionAsync(transaction =>
        {
            transaction.Create(item, new { quantity = 2 });
            audit = AdminAudit.AddAdminAudit(transaction, db, actor, "test.atomic", "test", item.Id, details);
            return Task.FromResult(0);
        });
        AdditionalContracts.Require((await item.GetSnapshotAsync()).Exists && (await audit!.GetSnapshotAsync()).Exists,
            "Audit and business write did not commit together");
        var rejectedItem = db.Collection("contractTestItems").Document();
        DocumentReference? rejectedAudit = null;
        try
        {
            await db.RunTransactionAsync<int>(transaction =>
            {
                transaction.Create(rejectedItem, new { quantity = 3 });
                rejectedAudit = AdminAudit.AddAdminAudit(transaction, db, actor, "test.rollback", "test", rejectedItem.Id);
                throw new InvalidOperationException("deliberate-rollback");
            });
            throw new Exception("Expected rollback");
        }
        catch (InvalidOperationException error) when (error.Message == "deliberate-rollback") { }
        AdditionalContracts.Require(!(await rejectedItem.GetSnapshotAsync()).Exists
            && !(await rejectedAudit!.GetSnapshotAsync()).Exists, "Rolled-back audit leaked into database");
        Console.WriteLine("PASS: local Firestore Emulator audit writes, server timestamp, atomic commit and rollback.");
        var suffix = Guid.NewGuid().ToString("N");
        var owner = new RoleUser("owner-" + suffix, "owner@example.invalid", new Dictionary<string, object> { ["admin"] = true, ["role"] = "owner" });
        var admin = new RoleUser("admin-" + suffix, null, new Dictionary<string, object> { ["admin"] = true });
        var removed = new RoleUser("removed-" + suffix, null, new Dictionary<string, object> { ["admin"] = "true" });
        var ownerRef = db.Collection("adminRoles").Document(owner.Uid);
        await ownerRef.SetAsync(new Dictionary<string, object> { ["customField"] = 7 });
        await AdminRoles.SyncAdminRoleAsync(db, owner);
        var ownerDoc = await ownerRef.GetSnapshotAsync();
        AdditionalContracts.Require(ownerDoc.GetValue<string>("role") == "owner" && ownerDoc.GetValue<long>("customField") == 7,
            "Role sync must merge and preserve owner");
        await db.Collection("adminRoles").Document(removed.Uid).SetAsync(new { role = "admin" });
        var users = new[] { owner, admin, removed };
        AdditionalContracts.Require(await AdminRoles.SyncAdminRolesAsync(db, users) == 2, "Backfill write count changed");
        AdditionalContracts.Require(await AdminRoles.SyncAdminRolesAsync(db, users) == 0, "Backfill must be idempotent");
        AdditionalContracts.Require(!(await db.Collection("adminRoles").Document(removed.Uid).GetSnapshotAsync()).Exists,
            "Non-boolean admin claim must remove role document");
        await AdminRoles.SyncAdminRoleAsync(db, owner, false);
        AdditionalContracts.Require(!(await ownerRef.GetSnapshotAsync()).Exists, "Explicit role removal failed");
        Console.WriteLine("PASS: Firestore role merge, owner preservation, batch backfill, idempotency and revocation.");
        long now = 1_700_000_000_000;
        var protection = new LoginProtection(db, () => now);
        var accountKey = "login-" + suffix;
        for (var failures = 1; failures <= 10; failures++)
        {
            var attempt = await protection.AcquireAsync(accountKey, 1);
            AdditionalContracts.Require(attempt.Code is null, "Login unexpectedly blocked after expiry");
            var competing = await protection.AcquireAsync(accountKey, 2);
            AdditionalContracts.Require(competing.Code == "login-in-progress", "Password version must not bypass active lease");
            var result = await protection.FinishAsync(attempt, "invalid");
            if (failures < 5) AdditionalContracts.Require(result.Code == "invalid-credential", "Initial attempt policy changed");
            else if (failures < 10)
            {
                var minutes = LoginProtection.LockMinutes[failures - 5];
                AdditionalContracts.Require(result.Code == "account-locked" && result.RetryAfter == minutes * 60, "Escalating lock changed");
                AdditionalContracts.Require((await protection.AcquireAsync(accountKey, 1)).Code == "account-locked", "Lock bypassed");
                now += minutes * 60_000L;
            }
            else AdditionalContracts.Require(result.Code == "password-reset-required", "Reset requirement missing");
        }
        AdditionalContracts.Require((await protection.AcquireAsync(accountKey, 1)).Code == "password-reset-required", "Reset requirement bypassed");
        var afterReset = await protection.AcquireAsync(accountKey, 2);
        AdditionalContracts.Require(afterReset.Code is null, "Server password version must reset lock");
        AdditionalContracts.Require((await protection.FinishAsync(afterReset, "success")).Status == 200, "Valid login failed");
        AdditionalContracts.Require(!(await afterReset.Ref!.GetSnapshotAsync()).Exists, "Successful login did not clear protection record");
        var unavailable = await protection.AcquireAsync(accountKey, 2);
        await protection.FinishAsync(unavailable, "unavailable");
        AdditionalContracts.Require(Convert.ToDouble((await unavailable.Ref!.GetSnapshotAsync()).GetValue<object>("failures")) == 0,
            "Provider outage must not count as password failure");
        var expired = await protection.AcquireAsync(accountKey, 2);
        now += LoginProtection.LeaseMs;
        AdditionalContracts.Require((await protection.FinishAsync(expired, "success")).Status == 503, "Expired lease accepted");
        var concurrentKey = "concurrent-" + suffix;
        var concurrent = await Task.WhenAll(protection.AcquireAsync(concurrentKey, 1), protection.AcquireAsync(concurrentKey, 1));
        AdditionalContracts.Require(concurrent.Count(result => result.Code is null) == 1
            && concurrent.Count(result => result.Code == "login-in-progress") == 1, "Concurrent login lease not serialized");
        Console.WriteLine("PASS: Firestore login leases, concurrent requests, escalating locks, reset version and provider outages.");
    }
}
