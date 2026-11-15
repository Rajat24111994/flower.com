using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Grpc.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Catalog;

/// <summary>Port of backend/catalog/product-images.js; image bytes remain in Firestore, addressed by SHA-1.</summary>
public sealed class ProductImagesHandler(Func<FirestoreDb> database, FirebaseAdminService authentication,
    ILogger<ProductImagesHandler> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.XContentTypeOptions = "nosniff";
        try
        {
            if (context.Request.Method == "GET") { await ShowPhotoAsync(context); return; }
            if (context.Request.Method == "POST") { await UploadPhotoAsync(context); return; }
            context.Response.Headers.Allow = "GET, POST";
            await FirebaseAdminService.SendErrorAsync(context, 405, "method-not-allowed", "Chỉ hỗ trợ xem hoặc tải ảnh lên.");
        }
        catch
        {
            logger.LogError("Product photo failed.");
            await FirebaseAdminService.SendErrorAsync(context, 503, "photo-unavailable", "Chưa xử lý được ảnh. Hãy thử lại.");
        }
    }

    private async Task UploadPhotoAsync(HttpContext context)
    {
        var db = database();
        var user = await authentication.VerifyRequestAsync(context);
        if (user is null) return;
        var role = await db.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync(context.RequestAborted);
        if (!user.Claims.TryGetValue("admin", out var admin) || admin is not true || !role.Exists)
        {
            await FirebaseAdminService.SendErrorAsync(context, 403, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới tải được ảnh sản phẩm."); return;
        }
        JsonElement photo = default;
        if (context.Request.ContentLength is not 0)
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            if (document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("photo", out var value))
                photo = value.Clone();
        }
        var photos = photo.ValueKind == JsonValueKind.Undefined
            ? JsonSerializer.SerializeToElement(new object?[] { null }) : JsonSerializer.SerializeToElement(new[] { photo });
        var bytes = ImageRules.ValidateReviewPhotos(photos)?.FirstOrDefault();
        if (bytes is null)
        {
            await FirebaseAdminService.SendErrorAsync(context, 400, "invalid-photo", "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); return;
        }
        var id = Convert.ToHexStringLower(SHA1.HashData(bytes));
        try
        {
            await db.Collection("productImages").Document(id).CreateAsync(new Dictionary<string, object>
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
        { await FirebaseAdminService.SendErrorAsync(context, 404, "photo-not-found", "Không tìm thấy ảnh."); return; }
        var photo = await database().Collection("productImages").Document(id).GetSnapshotAsync(context.RequestAborted);
        if (!photo.Exists)
        { await FirebaseAdminService.SendErrorAsync(context, 404, "photo-not-found", "Không tìm thấy ảnh."); return; }
        var bytes = photo.GetValue<byte[]>("bytes");
        context.Response.ContentType = "image/jpeg";
        context.Response.ContentLength = bytes.Length;
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        context.Response.StatusCode = 200;
        await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
    }
}
