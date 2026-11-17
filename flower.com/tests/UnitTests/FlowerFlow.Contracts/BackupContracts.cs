using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Google.Cloud.Firestore;
using Grpc.Core;

static class BackupContracts
{
    public static async Task RunAsync(string root)
    {
        using var fixture = await AdditionalContracts.OracleAsync(root, "backup-oracle.cjs");
        var backup = fixture.RootElement.GetProperty("backup"); const string pass = "mật khẩu sao lưu123";
        var decrypted = FirestoreBackup.Decrypt(fixture.RootElement.GetProperty("encrypted").GetString()!, pass);
        AdditionalContracts.Require(JsonNode.DeepEquals(JsonNode.Parse(backup.GetRawText()), JsonNode.Parse(decrypted.GetRawText())), "C# cannot decrypt Node backups");
        var encrypted = FirestoreBackup.Encrypt(backup, pass); var filename = Path.Combine(Path.GetTempPath(), "flowerflow-backup-" + Guid.NewGuid().ToString("N") + ".enc");
        try
        {
            await File.WriteAllTextAsync(filename, encrypted);
            var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(Path.Combine(root, "flower.com/tests/UnitTests/FlowerFlow.Contracts/backup-oracle.cjs")); start.ArgumentList.Add(filename);
            using var process = Process.Start(start)!; var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync(); await process.WaitForExitAsync();
            AdditionalContracts.Require(process.ExitCode == 0 && JsonNode.DeepEquals(JsonNode.Parse(await output), JsonNode.Parse(backup.GetRawText())), "Node cannot decrypt C# backups: " + await errors);
        }
        finally { File.Delete(filename); }
        try { FirestoreBackup.Decrypt(encrypted, "wrong password"); throw new Exception("Wrong backup password accepted"); } catch (InvalidOperationException error) { AdditionalContracts.Require(error.Message.StartsWith("Không giải mã được:"), "Backup fault leaked details"); }
        var tampered = JsonNode.Parse(encrypted)!; var data = Convert.FromBase64String(tampered["data"]!.GetValue<string>()); data[0] ^= 1; tampered["data"] = Convert.ToBase64String(data);
        try { FirestoreBackup.Decrypt(tampered.ToJsonString(), pass); throw new Exception("Tampered backup accepted"); } catch (InvalidOperationException) { }
        var db = new FirestoreDbBuilder { ProjectId = "demo-flowerflow-csharp", Endpoint = "127.0.0.1:8787", ChannelCredentials = ChannelCredentials.Insecure }.Build();
        var original = new Dictionary<string, object> { ["time"] = Timestamp.FromDateTime(new DateTime(2026,11,15,0,0,0,DateTimeKind.Utc)), ["point"] = new GeoPoint(10,106), ["ref"] = db.Document("items/one"), ["bytes"] = Blob.CopyFrom([1,2,3]), ["nested"] = new List<object> { 3d, false } };
        var serialized = JsonSerializer.SerializeToElement(FirestoreBackup.SerializeValue(original));
        var integerPoint = JsonSerializer.SerializeToElement(FirestoreBackup.SerializeValue(new Dictionary<string, object> { ["latitude"] = 10L, ["longitude"] = 106L }));
        AdditionalContracts.Require(!integerPoint.TryGetProperty("__type", out _) && integerPoint.GetProperty("latitude").GetInt64() == 10,
            "A plain map with coordinates must not be retyped as a GeoPoint");
        var jsonBytes = JsonSerializer.SerializeToElement(FirestoreValues.JsonCompatible(Blob.CopyFrom([1,2,3])));
        AdditionalContracts.Require(jsonBytes.GetProperty("type").GetString() == "Buffer" && jsonBytes.GetProperty("data")[2].GetInt32() == 3, "Firestore blob JSON differs from Node Buffer.toJSON");
        var restored = (Dictionary<string, object>)FirestoreBackup.DeserializeValue(serialized, db)!;
        AdditionalContracts.Require(restored["time"] is Timestamp && restored["point"] is GeoPoint point && point.Latitude == 10 && restored["ref"] is DocumentReference reference && reference.Equals(db.Document("items/one")) && ((byte[])restored["bytes"]).SequenceEqual(new byte[]{1,2,3}), "Firestore backup native value markers changed");
        Console.WriteLine("PASS: Node/C# backup encryption interoperability, tamper/password rejection and timestamp/geopoint/reference/blob round trips.");
    }
    public static async Task EmulatorAsync(FirestoreDb db)
    {
        var id = "backup-test-" + Guid.NewGuid().ToString("N");
        await db.Collection(id).Document("keep").SetAsync(new { untouched = true });
        await db.Document(id + "/keep/events/child").SetAsync(new { value = "nested" });
        await db.Document(id + "/missing/events/orphan").SetAsync(new { value = "orphan" });
        await db.Collection("orderLookupLimits").Document("backup-skip").SetAsync(new { count = 1 });
        var documents = Enumerable.Range(0,401).ToDictionary(index => "doc" + index, index => (object)new Dictionary<string, object> { ["quantity"] = (double)index });
        var backup = JsonSerializer.SerializeToElement(new Dictionary<string, object> { ["format"] = FirestoreBackup.Format, ["collections"] = new Dictionary<string, object> { [id] = documents } });
        var counts = await FirestoreBackup.ImportAsync(db, backup);
        AdditionalContracts.Require(counts[id] == 401 && (await db.Collection(id).GetSnapshotAsync()).Count == 402 && (await db.Collection(id).Document("doc1").GetSnapshotAsync()).ToDictionary()["quantity"] is long, "Backup import batching or preservation of unrelated documents changed");
        var exported = JsonSerializer.SerializeToElement(await FirestoreBackup.ExportAsync(db));
        AdditionalContracts.Require(!exported.GetProperty("collections").TryGetProperty("orderLookupLimits", out _) && FirestoreBackup.CountDocuments(exported)[id] == 402, "Backup export skipped business data or included lookup counters");
        AdditionalContracts.Require(FirestoreBackup.CountDocuments(exported)[id + "/missing/events"] == 1,
            "Backup export lost a subcollection beneath a missing parent");
        var clone = id + "-clone";
        var tree = JsonNode.Parse(exported.GetRawText())!["collections"]!.AsObject();
        var selected = new JsonObject();
        foreach (var pair in tree.Where(pair => pair.Key == id || pair.Key.StartsWith(id + "/", StringComparison.Ordinal)))
            selected[clone + pair.Key[id.Length..]] = pair.Value!.DeepClone();
        var cloneArchive = JsonSerializer.SerializeToElement(new { format = FirestoreBackup.Format, collections = selected });
        await FirestoreBackup.ImportAsync(db, cloneArchive);
        AdditionalContracts.Require((await db.Document(clone + "/keep/events/child").GetSnapshotAsync()).GetValue<string>("value") == "nested"
            && (await db.Document(clone + "/missing/events/orphan").GetSnapshotAsync()).Exists
            && !(await db.Document(clone + "/missing").GetSnapshotAsync()).Exists, "Nested restore created a missing parent or lost children");
        Console.WriteLine("PASS: Firestore backup batching, nested/orphan subcollections, unrelated document preservation and skipped lookup counters.");
    }
}
