using System.Collections;
using Google.Cloud.Firestore;

namespace FlowerFlow.Application.Common.Firestore;

// Node's serializer stores Number.isSafeInteger values as Firestore integers.
// Keep that wire type even when JavaScript arithmetic was ported using double.
public static class FirestoreWrites
{
    public static object? Normalize(object? value) => value switch
    {
        double number when double.IsFinite(number) && Math.Truncate(number) == number && Math.Abs(number) <= 9007199254740991d
            && !(number == 0 && BitConverter.DoubleToInt64Bits(number) < 0) => (long)number,
        IDictionary<string, object> map => Data(map),
        byte[] => value,
        IEnumerable items when value is not string => items.Cast<object?>().Select(Normalize).ToList(),
        _ => value
    };
    private static Dictionary<string, object> Data(IDictionary<string, object> data) =>
        data.ToDictionary(pair => pair.Key, pair => Normalize(pair.Value)!);
    public static void CreateJs(this Transaction transaction, DocumentReference reference, IDictionary<string, object> data) => transaction.Create(reference, Data(data));
    public static void UpdateJs(this Transaction transaction, DocumentReference reference, IDictionary<string, object> data) => transaction.Update(reference, Data(data));
    public static void SetJs(this Transaction transaction, DocumentReference reference, IDictionary<string, object> data) => transaction.Set(reference, Data(data));
    public static void SetJs(this WriteBatch batch, DocumentReference reference, IDictionary<string, object> data) => batch.Set(reference, Data(data));
    public static Task<WriteResult> CreateJsAsync(this DocumentReference reference, IDictionary<string, object> data, CancellationToken cancellationToken = default) => reference.CreateAsync(Data(data), cancellationToken);
    public static Task<WriteResult> SetJsAsync(this DocumentReference reference, IDictionary<string, object> data, SetOptions options, CancellationToken cancellationToken = default) => reference.SetAsync(Data(data), options, cancellationToken);
}
