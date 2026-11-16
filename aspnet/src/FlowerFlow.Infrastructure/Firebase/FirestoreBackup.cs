using System.Collections;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FlowerFlow.Application.Compatibility;
using Google.Cloud.Firestore;
using Google.Protobuf;
using Org.BouncyCastle.Crypto.Generators;

namespace FlowerFlow.Infrastructure.Firebase;

public static class FirestoreBackup
{
    public const string Format = "flowerflow-backup-v1";
    private const string EncryptedFormat = Format + "+aes-256-gcm";
    private static bool IsNumber(object? value) => value is byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal;
    private static Dictionary<string, object> Marker(string type, object value) => new() { ["__type"] = type, ["value"] = value };
    public static object? SerializeValue(object? value) => value switch
    {
        null => null,
        Timestamp timestamp => Marker("timestamp", FirestoreValues.ToIso(timestamp)),
        GeoPoint point => Marker("geopoint", new Dictionary<string, object> { ["latitude"] = point.Latitude, ["longitude"] = point.Longitude }),
        DocumentReference reference => Marker("reference", reference.Path[(reference.Path.IndexOf("/documents/", StringComparison.Ordinal) + 11)..]),
        Blob blob => Marker("bytes", Convert.ToBase64String(blob.ByteString.ToByteArray())),
        ByteString bytes => Marker("bytes", Convert.ToBase64String(bytes.ToByteArray())),
        byte[] bytes => Marker("bytes", Convert.ToBase64String(bytes)),
        IDictionary<string, object> map when map.TryGetValue("latitude", out var latitude) && IsNumber(latitude) && map.TryGetValue("longitude", out var longitude) && IsNumber(longitude) =>
            Marker("geopoint", new Dictionary<string, object> { ["latitude"] = latitude, ["longitude"] = longitude }),
        IDictionary<string, object> map => map.ToDictionary(pair => pair.Key, pair => SerializeValue(pair.Value)),
        IEnumerable sequence when value is not string => sequence.Cast<object?>().Select(SerializeValue).ToList(),
        _ => value
    };
    public static object? DeserializeValue(JsonElement value, FirestoreDb db)
    {
        if (value.ValueKind == JsonValueKind.Array) return value.EnumerateArray().Select(item => DeserializeValue(item, db)).ToList();
        if (value.ValueKind != JsonValueKind.Object) return value.ValueKind switch
        { JsonValueKind.String => value.GetString(), JsonValueKind.Number => value.GetDouble(), JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
        var type = Js.Get(value, "__type"); var data = Js.Get(value, "value");
        if (type.ValueKind == JsonValueKind.String) switch (type.GetString())
        {
            case "timestamp": return Timestamp.FromDateTime(DateTimeOffset.Parse(data.GetString()!, System.Globalization.CultureInfo.InvariantCulture).UtcDateTime);
            case "geopoint": return new GeoPoint(data.GetProperty("latitude").GetDouble(), data.GetProperty("longitude").GetDouble());
            case "reference": return db.Document(data.GetString()!);
            case "bytes": return Convert.FromBase64String(data.GetString()!);
        }
        return value.EnumerateObject().ToDictionary(property => property.Name, property => DeserializeValue(property.Value, db)!);
    }
    public static async Task<Dictionary<string, object>> ExportAsync(FirestoreDb db, CancellationToken cancellationToken = default)
    {
        var collections = new Dictionary<string, object>();
        await foreach (var collection in db.ListRootCollectionsAsync().WithCancellation(cancellationToken))
        {
            if (collection.Id == "orderLookupLimits") continue;
            var snapshot = await collection.GetSnapshotAsync(cancellationToken);
            collections[collection.Id] = snapshot.Documents.ToDictionary(document => document.Id, document => SerializeValue(document.ToDictionary()));
        }
        return new() { ["format"] = Format, ["createdAt"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), ["collections"] = collections };
    }
    public static Dictionary<string, int> CountDocuments(JsonElement backup) => backup.GetProperty("collections").EnumerateObject()
        .ToDictionary(collection => collection.Name, collection => collection.Value.EnumerateObject().Count());
    public static async Task<Dictionary<string, int>> ImportAsync(FirestoreDb db, JsonElement backup, CancellationToken cancellationToken = default)
    {
        if (Js.Get(backup, "format").ValueKind != JsonValueKind.String || Js.Get(backup, "format").GetString() != Format || Js.Get(backup, "collections").ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("File không phải bản sao lưu FlowerFlow hợp lệ.");
        var writes = new List<(DocumentReference Reference, Dictionary<string, object> Data)>();
        foreach (var collection in backup.GetProperty("collections").EnumerateObject())
            foreach (var document in collection.Value.EnumerateObject())
                writes.Add((db.Collection(collection.Name).Document(document.Name), (Dictionary<string, object>)DeserializeValue(document.Value, db)!));
        foreach (var chunk in writes.Chunk(400))
        {
            var batch = db.StartBatch(); foreach (var write in chunk) batch.SetJs(write.Reference, write.Data);
            await batch.CommitAsync(cancellationToken);
        }
        return CountDocuments(backup);
    }
    private static byte[] DeriveKey(string passphrase, byte[] salt) => SCrypt.Generate(Encoding.UTF8.GetBytes(passphrase), salt, 16384, 8, 1, 32);
    public static string Encrypt(JsonElement backup, string passphrase)
    {
        if (passphrase.Length < 12) throw new InvalidOperationException("Mật khẩu sao lưu (BACKUP_PASSPHRASE) cần ít nhất 12 ký tự.");
        var salt = RandomNumberGenerator.GetBytes(16); var iv = RandomNumberGenerator.GetBytes(12); var tag = new byte[16];
        var plaintext = Encoding.UTF8.GetBytes(JsJson.Stringify(backup)); var ciphertext = new byte[plaintext.Length]; var key = DeriveKey(passphrase, salt);
        try { using var aes = new AesGcm(key, 16); aes.Encrypt(iv, plaintext, ciphertext, tag); }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plaintext); }
        return JsonSerializer.Serialize(new { format = EncryptedFormat, salt = Convert.ToBase64String(salt), iv = Convert.ToBase64String(iv), tag = Convert.ToBase64String(tag), data = Convert.ToBase64String(ciphertext) });
    }
    public static JsonElement Decrypt(string text, string passphrase)
    {
        using var envelope = JsonDocument.Parse(text); var file = envelope.RootElement;
        if (Js.Get(file, "format").ValueKind != JsonValueKind.String || Js.Get(file, "format").GetString() != EncryptedFormat)
            throw new InvalidOperationException("File không phải bản sao lưu FlowerFlow đã mã hóa.");
        try
        {
            var key = DeriveKey(passphrase, Convert.FromBase64String(file.GetProperty("salt").GetString()!));
            var ciphertext = Convert.FromBase64String(file.GetProperty("data").GetString()!); var plaintext = new byte[ciphertext.Length];
            try
            {
                using var aes = new AesGcm(key, 16);
                aes.Decrypt(Convert.FromBase64String(file.GetProperty("iv").GetString()!), ciphertext, Convert.FromBase64String(file.GetProperty("tag").GetString()!), plaintext);
                using var document = JsonDocument.Parse(plaintext); return document.RootElement.Clone();
            }
            finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plaintext); }
        }
        catch { throw new InvalidOperationException("Không giải mã được: sai mật khẩu sao lưu hoặc file đã bị sửa."); }
    }
}
