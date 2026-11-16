using System.Buffers.Binary;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FlowerFlow.Application.Catalog;

/// <summary>Port of backend/catalog/image-rules.js. Validates bytes without decoding/re-encoding images.</summary>
public static class ImageRulesService
{
    public const int MaxReviewPhotos = 3;
    public const int MaxPhotoBytes = 120 * 1024;
    private static readonly Regex DataUri = new(@"^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$",
        RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public sealed record Dimensions(int Height, int Width);

    public static Dimensions? JpegDimensions(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 12 || bytes[0] != 0xff || bytes[1] != 0xd8
            || bytes[^2] != 0xff || bytes[^1] != 0xd9) return null;
        var offset = 2;
        while (offset + 4 < bytes.Length)
        {
            if (bytes[offset++] != 0xff) return null;
            while (offset < bytes.Length && bytes[offset] == 0xff) offset++;
            if (offset >= bytes.Length) return null;
            var marker = bytes[offset++];
            if (marker is 0xda or 0xd9) return null;
            if (marker == 0x01 || marker is >= 0xd0 and <= 0xd7) continue;
            if (offset + 2 > bytes.Length) return null;
            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes[offset..]);
            if (length < 2 || offset + length > bytes.Length) return null;
            if (marker is 0xc0 or 0xc1 or 0xc2)
            {
                if (length < 8) return null;
                return new Dimensions(BinaryPrimitives.ReadUInt16BigEndian(bytes[(offset + 3)..]),
                    BinaryPrimitives.ReadUInt16BigEndian(bytes[(offset + 5)..]));
            }
            offset += length;
        }
        return null;
    }

    // Undefined means the JS default argument ([]); explicit JSON null remains invalid.
    public static IReadOnlyList<byte[]>? ValidateReviewPhotos(JsonElement photos = default)
    {
        if (photos.ValueKind == JsonValueKind.Undefined) return Array.Empty<byte[]>();
        if (photos.ValueKind != JsonValueKind.Array || photos.GetArrayLength() > MaxReviewPhotos) return null;
        var result = new List<byte[]>();
        foreach (var photo in photos.EnumerateArray())
        {
            if (photo.ValueKind != JsonValueKind.String) return null;
            var value = photo.GetString()!;
            if (value.Length > (int)Math.Ceiling(MaxPhotoBytes / 3d) * 4 + 30 || !DataUri.IsMatch(value)) return null;
            var encoded = value[(value.IndexOf(',') + 1)..];
            byte[] bytes;
            try { bytes = Convert.FromBase64String(encoded); }
            catch (FormatException) { return null; }
            if (bytes.Length > MaxPhotoBytes || Convert.ToBase64String(bytes) != encoded) return null;
            var dimensions = JpegDimensions(bytes);
            if (dimensions is null || dimensions.Width < 1 || dimensions.Height < 1
                || dimensions.Width > 1600 || dimensions.Height > 1600) return null;
            result.Add(bytes);
        }
        return result;
    }
}
