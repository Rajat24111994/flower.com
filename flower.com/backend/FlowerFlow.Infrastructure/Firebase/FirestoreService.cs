using Google.Cloud.Firestore;

namespace FlowerFlow.Infrastructure.Firebase;

/// <summary>
/// Hands the shared Firestore client (created lazily by <see cref="FirebaseAdminService"/>) to the
/// Application services, which receive it as <c>Func&lt;FirestoreDb&gt;</c> so nothing connects at startup.
/// </summary>
public sealed class FirestoreService(FirebaseAdminService admin)
{
    public FirestoreDb GetDatabase() => admin.GetAdminFirestore();
}
