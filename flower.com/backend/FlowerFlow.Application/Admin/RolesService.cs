using Google.Cloud.Firestore;

using FlowerFlow.Domain.Entities;

namespace FlowerFlow.Application.Admin;


/// <summary>Port of backend/admin/roles.js; mirrors claims without overwriting existing backfill documents.</summary>
public static class RolesService
{
    public static bool IsAdminUser(RoleUser user) => user.CustomClaims?.TryGetValue("admin", out var admin) == true && admin is true;

    public static async Task SyncAdminRoleAsync(FirestoreDb db, RoleUser user, bool? isAdmin = null,
        CancellationToken cancellationToken = default)
    {
        var reference = db.Collection(AdminRole.Collection).Document(user.Uid);
        if (isAdmin ?? IsAdminUser(user))
            await reference.SetJsAsync(RoleData(user), SetOptions.MergeAll, cancellationToken);
        else await reference.DeleteAsync(cancellationToken: cancellationToken);
    }

    public static async Task<int> SyncAdminRolesAsync(FirestoreDb db, IReadOnlyList<RoleUser> users,
        CancellationToken cancellationToken = default)
    {
        var references = users.Select(user => db.Collection(AdminRole.Collection).Document(user.Uid)).ToArray();
        var existing = await db.GetAllSnapshotsAsync(references, cancellationToken);
        var batch = db.StartBatch();
        var writes = 0;
        for (var index = 0; index < users.Count; index++)
        {
            if (IsAdminUser(users[index]) && !existing[index].Exists)
            {
                batch.SetJs(references[index], RoleData(users[index])); writes++;
            }
            else if (!IsAdminUser(users[index]) && existing[index].Exists)
            {
                batch.Delete(references[index]); writes++;
            }
        }
        if (writes > 0) await batch.CommitAsync(cancellationToken);
        return writes;
    }

    private static Dictionary<string, object> RoleData(RoleUser user) => new()
    {
        ["email"] = user.Email ?? "",
        ["role"] = user.CustomClaims?.TryGetValue("role", out var role) == true && role is "owner" ? "owner" : "admin",
        ["updatedAt"] = FieldValue.ServerTimestamp
    };
}
