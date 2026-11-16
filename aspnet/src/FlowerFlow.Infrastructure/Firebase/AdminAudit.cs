using FlowerFlow.Application.Compatibility;
using Google.Cloud.Firestore;

namespace FlowerFlow.Infrastructure.Firebase;

/// <summary>Port of shared/admin-audit.js. Transactional audit writes remain in the caller's transaction.</summary>
public static class AdminAudit
{
    public static Dictionary<string, object> MakeEntry(FirebaseIdentity? actor, string action, string resourceType,
        string? resourceId) => MakeEntry(actor, action, resourceType, resourceId, new Dictionary<string, object>());

    public static Dictionary<string, object> MakeEntry(FirebaseIdentity? actor, string action, string resourceType,
        string? resourceId, object? details)
    {
        var email = actor?.Claims.TryGetValue("email", out var value) == true
            ? Js.StringOrEmpty(Js.Element(value)) : "";
        return new Dictionary<string, object>
        {
            ["actorUid"] = Cut(actor?.Uid ?? "", 128), ["actorEmail"] = Cut(email, 320),
            ["action"] = Cut(action, 80), ["resourceType"] = Cut(resourceType, 80),
            ["resourceId"] = Cut(resourceId ?? "", 128), ["details"] = details!,
            ["createdAt"] = FieldValue.ServerTimestamp
        };
    }

    public static DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId) =>
        AddAdminAudit(transaction, db, actor, action, resourceType, resourceId, new Dictionary<string, object>());

    public static DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, object? details)
    {
        var reference = db.Collection("adminAudit").Document();
        transaction.CreateJs(reference, MakeEntry(actor, action, resourceType, resourceId, details));
        return reference;
    }

    public static Task<DocumentReference> RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, CancellationToken cancellationToken = default) =>
        RecordAdminAuditAsync(db, actor, action, resourceType, resourceId, new Dictionary<string, object>(), cancellationToken);

    public static async Task<DocumentReference> RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, object? details, CancellationToken cancellationToken = default)
    {
        var reference = db.Collection("adminAudit").Document();
        await reference.CreateJsAsync(MakeEntry(actor, action, resourceType, resourceId, details), cancellationToken);
        return reference;
    }

    private static string Cut(string value, int limit) => value[..Math.Min(value.Length, limit)];
}
