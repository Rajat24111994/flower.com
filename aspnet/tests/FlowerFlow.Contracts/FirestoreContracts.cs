using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Grpc.Core;

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
    }
}
