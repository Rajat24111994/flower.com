using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using Grpc.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

using FlowerFlow.Domain.Entities;

namespace FlowerFlow.Application.Catalog;

/// <summary>Port of backend/catalog/product-images.js; image bytes remain in Firestore, addressed by SHA-1.</summary>
public sealed class ProductImagesService(Func<FirestoreDb> database, IFirebaseAuthService authentication,
    ILogger<ProductImagesService> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.XContentTypeOptions = "nosniff";
        try
        {
            if (context.Request.Method == "GET") { await ShowPhotoAsync(context); return; }
            if (context.Request.Method == "POST") { await UploadPhotoAsync(context); return; }
            context.Response.Headers.Allow = "GET, POST";
            await ApiResponse.SendErrorAsync(context, 405, "method-not-allowed", "Chỉ hỗ trợ xem hoặc tải ảnh lên.");
        }
        catch
        {
            logger.LogError("Product photo failed.");
            await ApiResponse.SendErrorAsync(context, 503, "photo-unavailable", "Chưa xử lý được ảnh. Hãy thử lại.");
        }
    }

    private async Task UploadPhotoAsync(HttpContext context)
    {
        var db = database();
        var user = await authentication.VerifyRequestAsync(context);
        if (user is null) return;
        var role = await db.Collection(AdminRole.Collection).Document(user.Uid).GetSnapshotAsync(context.RequestAborted);
        if (!user.Claims.TryGetValue("admin", out var admin) || admin is not true || !role.Exists)
        {
            await ApiResponse.SendErrorAsync(context, 403, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới tải được ảnh sản phẩm."); return;
        }
        JsonElement photo = default;
        // BackendServer has already consumed and cached the JSON request body.
        var body = await JsonInput.ReadAsync(context);
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("photo", out var value))
            photo = value.Clone();
        var photos = photo.ValueKind == JsonValueKind.Undefined
            ? JsonSerializer.SerializeToElement(new object?[] { null }) : JsonSerializer.SerializeToElement(new[] { photo });
        var bytes = ImageRulesService.ValidateReviewPhotos(photos)?.FirstOrDefault();
        if (bytes is null)
        {
            await ApiResponse.SendErrorAsync(context, 400, "invalid-photo", "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); return;
        }
        var id = Convert.ToHexStringLower(SHA1.HashData(bytes));
        try
        {
            await db.Collection(FirestoreCollections.ProductImages).Document(id).CreateJsAsync(new Dictionary<string, object>
            {
                ["bytes"] = bytes, ["size"] = bytes.Length, ["uploadedBy"] = user.Uid, ["createdAt"] = FieldValue.ServerTimestamp
            }, context.RequestAborted);
        }
        catch (RpcException error) when (error.StatusCode == StatusCode.AlreadyExists) { }
        context.Response.StatusCode = 201;
        await context.Response.WriteAsJsonAsync(new { url = $"/api/product-images?id={id}" }, context.RequestAborted);
    }

    private async Task ShowPhotoAsync(HttpContext context)
    {
        var id = context.Request.Query["id"].ToString();
        if (!Regex.IsMatch(id, @"\A[a-f0-9]{40}\z"))
        { await ApiResponse.SendErrorAsync(context, 404, "photo-not-found", "Không tìm thấy ảnh."); return; }
        var photo = await database().Collection(FirestoreCollections.ProductImages).Document(id).GetSnapshotAsync(context.RequestAborted);
        if (!photo.Exists)
        { await ApiResponse.SendErrorAsync(context, 404, "photo-not-found", "Không tìm thấy ảnh."); return; }
        var bytes = photo.GetValue<byte[]>("bytes");
        context.Response.ContentType = "image/jpeg";
        context.Response.ContentLength = bytes.Length;
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        context.Response.StatusCode = 200;
        await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
    }
}
