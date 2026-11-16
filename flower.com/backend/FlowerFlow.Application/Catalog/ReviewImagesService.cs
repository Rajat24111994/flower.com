using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

using FlowerFlow.Domain.Entities;

namespace FlowerFlow.Application.Catalog;

/// <summary>Port of backend/catalog/review-images.js.</summary>
public sealed class ReviewImagesService(Func<FirestoreDb> database, IFirebaseAdminService auth, ILogger<ReviewImagesService> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        Task Error(int status, string code, string message) => ApiResponse.SendErrorAsync(context, status, code, message);
        Task Missing() => Error(404, "photo-not-found", "Không tìm thấy ảnh.");
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = "GET";
            await Error(405, "method-not-allowed", "Chỉ hỗ trợ xem ảnh."); return;
        }
        var id = context.Request.Query["id"].ToString();
        if (!Regex.IsMatch(id, @"\A[a-f0-9]{40}_[0-2]\z")) { await Missing(); return; }
        try
        {
            var db = database();
            var review = await db.Collection(FirestoreCollections.Reviews).Document(id[..40]).GetSnapshotAsync(context.RequestAborted);
            if (!review.Exists) { await Missing(); return; }
            var data = review.ToDictionary();
            var allowed = data.GetValueOrDefault("moderationStatus") is "approved";
            if (!allowed)
            {
                var match = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+([^\r\n\u2028\u2029]+)$", RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    FirebaseIdentity user;
                    try { user = await auth.VerifyIdTokenAsync(match.Groups[1].Value, true, context.RequestAborted); }
                    catch { await Error(401, "unauthenticated", "Phiên đăng nhập hết hạn."); return; }
                    allowed = data.GetValueOrDefault("authorUid") as string == user.Uid;
                    if (!allowed && user.Claims.TryGetValue("admin", out var admin) && admin is true)
                        allowed = (await db.Collection(AdminRole.Collection).Document(user.Uid).GetSnapshotAsync(context.RequestAborted)).Exists;
                }
            }
            if (!allowed || data.GetValueOrDefault("photoIds") is not IEnumerable<object> photoIds || !photoIds.Contains(id))
            { await Missing(); return; }
            var photo = await db.Collection(FirestoreCollections.ReviewImages).Document(id).GetSnapshotAsync(context.RequestAborted);
            if (!photo.Exists || photo.ToDictionary().GetValueOrDefault("reviewId") as string != review.Id) { await Missing(); return; }
            var bytes = photo.GetValue<byte[]>("bytes");
            context.Response.ContentType = "image/jpeg";
            context.Response.ContentLength = bytes.Length;
            context.Response.StatusCode = 200;
            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        }
        catch
        {
            logger.LogError("Review photo failed.");
            await Error(503, "photo-unavailable", "Chưa tải được ảnh. Hãy thử lại.");
        }
    }
}
