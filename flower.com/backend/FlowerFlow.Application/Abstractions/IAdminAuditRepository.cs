using Google.Cloud.Firestore;

namespace FlowerFlow.Application.Abstractions;

/// <summary>Writes <c>adminAudit</c> records, inside the caller's transaction when one is given.</summary>
public interface IAdminAuditRepository
{
    DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor, string action, string resourceType, string? resourceId);
    DocumentReference AddAdminAudit(Transaction transaction, FirestoreDb db, FirebaseIdentity? actor, string action, string resourceType, string? resourceId, object? details);
    Task<DocumentReference> RecordAdminAuditAsync(FirestoreDb db, FirebaseIdentity? actor, string action, string resourceType, string? resourceId,
        object? details, CancellationToken cancellationToken = default);
}
