using Google.Cloud.Firestore;

namespace FlowerFlow.Infrastructure.Audit;

/// <summary>Port of shared/admin-audit.js. Transactional audit writes remain in the caller's transaction.</summary>
public sealed class AdminAuditRepository : IAdminAuditRepository
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
            ["actorUid"] = Cut(actor?.Uid ?? "", AdminAudit.ActorUidMaxLength), ["actorEmail"] = Cut(email, AdminAudit.ActorEmailMaxLength),
            ["action"] = Cut(action, AdminAudit.ActionMaxLength), ["resourceType"] = Cut(resourceType, AdminAudit.ResourceTypeMaxLength),
            ["resourceId"] = Cut(resourceId ?? "", AdminAudit.ResourceIdMaxLength), ["details"] = details!,
            ["createdAt"] = FieldValue.ServerTimestamp
        };
    }

    public static DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId) =>
        AddAdminAudit(transaction, db, actor, action, resourceType, resourceId, new Dictionary<string, object>());

    public static DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, object? details)
    {
        var reference = db.Collection(AdminAudit.Collection).Document();
        transaction.CreateJs(reference, MakeEntry(actor, action, resourceType, resourceId, details));
        return reference;
    }

    public static Task<DocumentReference> RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, CancellationToken cancellationToken = default) =>
        RecordAdminAuditAsync(db, actor, action, resourceType, resourceId, new Dictionary<string, object>(), cancellationToken);

    public static async Task<DocumentReference> RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, object? details, CancellationToken cancellationToken = default)
    {
        var reference = db.Collection(AdminAudit.Collection).Document();
        await reference.CreateJsAsync(MakeEntry(actor, action, resourceType, resourceId, details), cancellationToken);
        return reference;
    }

    private static string Cut(string value, int limit) => value[..Math.Min(value.Length, limit)];

    DocumentReference IAdminAuditRepository.AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId) => AddAdminAudit(transaction, db, actor, action, resourceType, resourceId);
    DocumentReference IAdminAuditRepository.AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor,
        string action, string resourceType, string? resourceId, object? details) => AddAdminAudit(transaction, db, actor, action, resourceType, resourceId, details);
    Task<DocumentReference> IAdminAuditRepository.RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor, string action,
        string resourceType, string? resourceId, object? details, CancellationToken cancellationToken) =>
        RecordAdminAuditAsync(db, actor, action, resourceType, resourceId, details, cancellationToken);
}
