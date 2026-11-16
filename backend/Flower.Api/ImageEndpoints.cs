using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using Grpc.Core;
using static Flower.Api.Data;

namespace Flower.Api;

public sealed class ImageEndpoints(FirebaseServices firebase)
{
    public static (int Width, int Height)? Dimensions(byte[] bytes)
    {
        if (bytes.Length < 12 || bytes[0] != 255 || bytes[1] != 216 || bytes[^2] != 255 || bytes[^1] != 217) return null;
        var offset = 2;
        while (offset + 4 < bytes.Length)
        {
            if (bytes[offset++] != 255) return null;
            while (offset < bytes.Length && bytes[offset] == 255) offset++;
            if (offset + 2 >= bytes.Length) return null;
            var marker = bytes[offset++];
            if (marker is 218 or 217) return null;
            if (marker == 1 || marker is >= 208 and <= 215) continue;
            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset));
            if (length < 2 || offset + length > bytes.Length) return null;
            if (marker is 192 or 193 or 194)
            {
                if (length < 8) return null;
                return (BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 5)), BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 3)));
            }
            offset += length;
        }
        return null;
    }
    public static List<byte[]>? Photos(object? input)
    {
        if (input == null) return null;
        if (input is not System.Collections.IList) return null;
        var photos = Arr(input);
        if (photos.Count > 3) return null;
        var result = new List<byte[]>();
        foreach (var photo in photos)
        {
            if (photo is not string value || value.Length > 163870 || !Regex.IsMatch(value, @"^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$")) return null;
            byte[] bytes;
            var encoded = value[(value.IndexOf(',') + 1)..];
            try { bytes = Convert.FromBase64String(encoded); } catch (FormatException) { return null; }
            var dimensions = Dimensions(bytes);
            if (bytes.Length > 120 * 1024 || Convert.ToBase64String(bytes) != encoded || dimensions == null || dimensions.Value.Width is < 1 or > 1600 || dimensions.Value.Height is < 1 or > 1600) return null;
            result.Add(bytes);
        }
        return result;
    }
    public async Task Handle(HttpContext context, bool review)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        if (context.Request.Method == "POST" && !review)
        {
            var user = await firebase.Verify(context);
            var db = firebase.Db;
            var role = await db.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync();
            Require(UserEndpoints.IsAdmin(user.Claims) && role.Exists, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới tải được ảnh sản phẩm.", 403);
            var body = await Body(context);
            var bytes = Photos(new List<object> { body.Get("photo")! })?.FirstOrDefault();
            Require(bytes != null, "invalid-photo", "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP khác.");
            var id = Convert.ToHexStringLower(SHA1.HashData(bytes!));
            try { await db.Collection("productImages").Document(id).CreateAsync(Map("bytes", bytes!, "size", bytes!.Length, "uploadedBy", user.Uid, "createdAt", FieldValue.ServerTimestamp)); }
            catch (RpcException error) when (error.StatusCode == StatusCode.AlreadyExists) { }
            context.Response.StatusCode = 201;
            await context.Response.WriteAsJsonAsync(new { url = $"/api/product-images?id={id}" });
            return;
        }
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = review ? "GET" : "GET, POST";
            throw Error("method-not-allowed", review ? "Chỉ hỗ trợ xem ảnh." : "Chỉ hỗ trợ xem hoặc tải ảnh lên.", 405);
        }
        var photoId = context.Request.Query["id"].ToString();
        Require(Regex.IsMatch(photoId, review ? "^[a-f0-9]{40}_[0-2]$" : "^[a-f0-9]{40}$"), "photo-not-found", "Không tìm thấy ảnh.", 404);
        var store = firebase.Db;
        if (review)
        {
            var snapshot = await store.Collection("reviews").Document(photoId[..40]).GetSnapshotAsync();
            var data = Read(snapshot);
            var allowed = data.S("moderationStatus") == "approved";
            if (!allowed && context.Request.Headers.Authorization.ToString().Length > 0)
            {
                var user = await firebase.Verify(context);
                allowed = user.Uid == data.S("authorUid");
                if (!allowed && UserEndpoints.IsAdmin(user.Claims)) allowed = (await store.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync()).Exists;
            }
            Require(snapshot.Exists && allowed && Arr(data.Get("photoIds")).Contains(photoId), "photo-not-found", "Không tìm thấy ảnh.", 404);
        }
        var photoSnapshot = await store.Collection(review ? "reviewImages" : "productImages").Document(photoId).GetSnapshotAsync();
        var photoData = Read(photoSnapshot);
        Require(photoSnapshot.Exists && (!review || photoData.S("reviewId") == photoId[..40]), "photo-not-found", "Không tìm thấy ảnh.", 404);
        var payload = photoData["bytes"] is Blob blob ? blob.ByteString.ToByteArray() : (byte[])photoData["bytes"];
        context.Response.ContentType = "image/jpeg";
        context.Response.ContentLength = payload.Length;
        if (!review) context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        await context.Response.Body.WriteAsync(payload);
    }
}
