using System.Text.Json;
using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Grpc.Core;
using Xunit;

namespace FlowerFlow.Api.Tests;

public sealed class BackupValidationTests
{
    [Fact]
    public void Coordinate_maps_keep_their_additional_fields()
    {
        var value = new Dictionary<string, object> { ["latitude"] = 10L, ["longitude"] = 106L, ["label"] = "Keep this address" };
        var serialized = JsonSerializer.SerializeToElement(FirestoreBackup.SerializeValue(value));
        Assert.False(serialized.TryGetProperty("__type", out _));
        Assert.Equal("Keep this address", serialized.GetProperty("label").GetString());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"a/b\":{}}")]
    [InlineData("{\"a//b\":{}}")]
    [InlineData("{\"a\":[]}")]
    [InlineData("{\"a\":{\"x/y\":{}}}")]
    [InlineData("{\"a\":{\"x\":null}}")]
    public async Task Malformed_archive_is_rejected_before_connecting_or_writing(string collections)
    {
        using var document = JsonDocument.Parse("{\"format\":\"flowerflow-backup-v1\",\"collections\":" + collections + "}");
        var db = new FirestoreDbBuilder { ProjectId = "demo-backup-validation", Endpoint = "127.0.0.1:1", ChannelCredentials = ChannelCredentials.Insecure }.Build();
        Assert.Throws<InvalidOperationException>(() => FirestoreBackup.CountDocuments(document.RootElement));
        await Assert.ThrowsAsync<InvalidOperationException>(() => FirestoreBackup.ImportAsync(db, document.RootElement));
    }

    [Fact]
    public void Nested_collection_paths_remain_compatible_with_v1_counts()
    {
        using var document = JsonDocument.Parse("{\"format\":\"flowerflow-backup-v1\",\"collections\":{\"a\":{\"one\":{}},\"a/one/events\":{\"event\":{}}}}");
        Assert.Equal(1, FirestoreBackup.CountDocuments(document.RootElement)["a/one/events"]);
    }
}
