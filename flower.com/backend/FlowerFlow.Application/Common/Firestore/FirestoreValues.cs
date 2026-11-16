using System.Globalization;
using Google.Cloud.Firestore;

namespace FlowerFlow.Application.Common.Firestore;

public static class FirestoreValues
{
    public static long ToMillis(Timestamp value)
    {
        var proto = value.ToProto(); return proto.Seconds * 1000 + proto.Nanos / 1_000_000;
    }
    // Node's Timestamp.toDate rounds nanoseconds to milliseconds; ToDateTime().fff would truncate.
    public static string ToIso(Timestamp value)
    {
        return ToDate(value).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }
    public static DateTimeOffset ToDate(Timestamp value)
    { var proto = value.ToProto(); return DateTimeOffset.FromUnixTimeMilliseconds(proto.Seconds * 1000 + (long)Math.Floor(proto.Nanos / 1_000_000d + 0.5)); }
    public static Timestamp FromMillis(long millis) => Timestamp.FromDateTime(DateTimeOffset.FromUnixTimeMilliseconds(millis).UtcDateTime);
    public static bool Truthy(object? value) => value switch
    { null => false, bool boolean => boolean, string text => text.Length > 0, double number => number != 0 && !double.IsNaN(number),
        long number => number != 0, int number => number != 0, _ => true };
    public static object Or(IDictionary<string, object> data, string name, object? fallback = null)
    { var value = data.TryGetValue(name, out var property) ? property : null; return Truthy(value) ? value! : fallback ?? ""; }
    public static object? JsonCompatible(object? value) => value switch
    {
        Timestamp timestamp => TimestampData(timestamp),
        Blob blob => JsonCompatible(blob.ByteString.ToByteArray()),
        Google.Protobuf.ByteString bytes => JsonCompatible(bytes.ToByteArray()),
        byte[] bytes => new Dictionary<string, object> { ["type"] = "Buffer", ["data"] = bytes.Select(b => (int)b).ToArray() },
        IDictionary<string, object> data => data.ToDictionary(pair => pair.Key, pair => JsonCompatible(pair.Value)),
        IEnumerable<object> items => items.Select(JsonCompatible).ToList(),
        double number when !double.IsFinite(number) => null,
        _ => value
    };
    private static Dictionary<string, object> TimestampData(Timestamp value)
    { var proto = value.ToProto(); return new() { ["_seconds"] = proto.Seconds, ["_nanoseconds"] = proto.Nanos }; }
}
