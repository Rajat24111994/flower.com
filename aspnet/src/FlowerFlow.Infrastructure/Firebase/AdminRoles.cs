using FirebaseAdmin.Auth;
using Google.Cloud.Firestore;

namespace FlowerFlow.Infrastructure.Firebase;

public sealed record RoleUser(string Uid, string? Email, IReadOnlyDictionary<string, object>? CustomClaims)
{
    public static RoleUser FromFirebase(UserRecord user) => new(user.Uid, user.Email, user.CustomClaims);
}

/// <summary>Port of backend/admin/roles.js; mirrors claims without overwriting existing backfill documents.</summary>
public static class AdminRoles
{
    public static bool IsAdminUser(RoleUser user) => user.CustomClaims?.TryGetValue("admin", out var admin) == true && admin is true;

    public static async Task SyncAdminRoleAsync(FirestoreDb db, RoleUser user, bool? isAdmin = null,
        CancellationToken cancellationToken = default)
    {
        var reference = db.Collection("adminRoles").Document(user.Uid);
        if (isAdmin ?? IsAdminUser(user))
            await reference.SetAsync(RoleData(user), SetOptions.MergeAll, cancellationToken);
        else await reference.DeleteAsync(cancellationToken: cancellationToken);
    }

    public static async Task<int> SyncAdminRolesAsync(FirestoreDb db, IReadOnlyList<RoleUser> users,
        CancellationToken cancellationToken = default)
    {
        var references = users.Select(user => db.Collection("adminRoles").Document(user.Uid)).ToArray();
        var existing = await db.GetAllSnapshotsAsync(references, cancellationToken);
        var batch = db.StartBatch();
        var writes = 0;
        for (var index = 0; index < users.Count; index++)
        {
            if (IsAdminUser(users[index]) && !existing[index].Exists)
            {
                batch.Set(references[index], RoleData(users[index])); writes++;
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
