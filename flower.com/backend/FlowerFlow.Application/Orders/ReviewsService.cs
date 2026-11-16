using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

using FlowerFlow.Domain.Entities;

namespace FlowerFlow.Application.Orders;

/// <summary>Port of backend/orders/reviews.js. A deterministic review id permits one review per delivered order.</summary>
public sealed class ReviewsService(Func<FirestoreDb> database, IFirebaseAdminService auth, TrackingService tracking, ILogger<ReviewsService> logger)
{
    public static string ReviewIdForOrder(string orderId) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("review:" + orderId)))[..40];
    private static bool ValidOrderId(string id) => id.Length is > 0 and <= 128 && !id.Contains('/');
    private static Task Error(HttpContext context, int status, string code, string message) => ApiResponse.SendErrorAsync(context, status, code, message);

    public async Task GetOwnReviewAsync(HttpContext context)
    {
        var body = await JsonInput.ReadAsync(context); var orderId = Js.StringOrEmpty(Js.Get(body, "orderId")).Trim();
        if (!ValidOrderId(orderId)) { await Error(context, 400, "invalid-argument", "Mã đơn không hợp lệ."); return; }
        try
        {
            var user = await tracking.OptionalAuthenticatedUserAsync(context);
            if (user is null) { await Error(context, 401, "unauthenticated", "Đăng nhập để xem đánh giá của bạn."); return; }
            var db = database(); var order = await db.Collection(Order.Collection).Document(orderId).GetSnapshotAsync(context.RequestAborted);
            if (!order.Exists || order.ToDictionary().GetValueOrDefault("uid") as string != user.Uid)
            { await Error(context, 404, "order-not-found", "Không tìm thấy đơn trong tài khoản."); return; }
            var review = await db.Collection(FirestoreCollections.Reviews).Document(ReviewIdForOrder(orderId)).GetSnapshotAsync(context.RequestAborted);
            Dictionary<string, object>? result = null;
            if (review.Exists)
            {
                result = review.ToDictionary(); result["id"] = review.Id; result["createdAt"] = TrackingService.SerializeTimestamp(result.GetValueOrDefault("createdAt")); result["orderId"] = orderId;
            }
            await context.Response.WriteAsJsonAsync(new { review = FirestoreValues.JsonCompatible(result) }, context.RequestAborted);
        }
        catch (RequestIdentityException error) when (error.Code.StartsWith("auth/", StringComparison.Ordinal))
        { await Error(context, 401, "unauthenticated", "Phiên đăng nhập hết hạn."); }
        catch { await Error(context, 503, "review-unavailable", "Chưa tải được đánh giá. Hãy thử lại."); }
    }

    public async Task SubmitReviewAsync(HttpContext context)
    {
        var match = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+([^\r\n\u2028\u2029]+)$", RegexOptions.IgnoreCase);
        if (!match.Success) { await Error(context, 401, "unauthenticated", "Đăng nhập tài khoản đã đặt đơn để gửi đánh giá."); return; }
        var body = await JsonInput.ReadAsync(context); var orderId = Js.StringOrEmpty(Js.Get(body, "orderId")).Trim();
        var rating = Js.Number(Js.Get(body, "rating")); var comment = Js.StringOrEmpty(Js.Get(body, "comment")).Trim();
        var photos = ImageRulesService.ValidateReviewPhotos(Js.Get(body, "photos"));
        if (photos is null)
        { await Error(context, 400, "invalid-photos", "Tối đa 3 ảnh JPEG đã tối ưu, mỗi ảnh không quá 120 KB và 1600px."); return; }
        if (!ValidOrderId(orderId) || !Js.Integer(rating) || rating is < 1 or > 5 || comment.Length is < 1 or > 1000)
        { await Error(context, 400, "invalid-argument", "Hãy chọn số sao và nhập nhận xét (tối đa 1000 ký tự)."); return; }
        FirebaseIdentity user;
        try { user = await auth.VerifyIdTokenAsync(match.Groups[1].Value, true, context.RequestAborted); }
        catch { await Error(context, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."); return; }
        try
        {
            var db = database(); var orderRef = db.Collection(Order.Collection).Document(orderId); var reviewRef = db.Collection(FirestoreCollections.Reviews).Document(ReviewIdForOrder(orderId));
            var review = await db.RunTransactionAsync(async transaction =>
            {
                var orderTask = transaction.GetSnapshotAsync(orderRef, context.RequestAborted); var reviewTask = transaction.GetSnapshotAsync(reviewRef, context.RequestAborted);
                await Task.WhenAll(orderTask, reviewTask); var orderSnapshot = await orderTask; var existing = await reviewTask;
                var order = orderSnapshot.Exists ? orderSnapshot.ToDictionary() : null;
                if (order is null || order.GetValueOrDefault("uid") as string != user.Uid || user.Uid.Length == 0)
                    throw new BackendException("order-not-found", "Không tìm thấy đơn hàng này trong tài khoản của bạn.");
                if (order.GetValueOrDefault("status") is not Order.Status.Delivered) throw new BackendException("order-not-delivered", "Chỉ có thể đánh giá đơn hàng đã giao.");
                if (existing.Exists) throw new BackendException("already-reviewed", "Bạn đã đánh giá đơn hàng này rồi.");
                var items = order.GetValueOrDefault("items") is IEnumerable<object> values ? values.ToList() : [];
                var productIds = PricingService.AggregateItems(Js.Element(items)).Select(item => (string)item["id"]).Where(id => id.Length > 0).Take(10).ToList();
                if (productIds.Count == 0) throw new BackendException("invalid-argument", "Đơn hàng không có thông tin sản phẩm để gắn đánh giá.");
                var name = Js.Cut(Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("customerName"))).Trim(), 80);
                var productName = Js.Cut(string.Join(", ", items.Select(item => Js.StringOrEmpty(Js.Get(Js.Element(item), "title"))).Where(text => text.Length > 0)), 500);
                var data = new Dictionary<string, object>
                {
                    ["authorUid"] = user.Uid, ["verifiedPurchase"] = true, ["moderationStatus"] = "pending",
                    ["photoIds"] = photos.Select((_, index) => $"{reviewRef.Id}_{index}").ToArray(), ["productIds"] = productIds,
                    ["productName"] = productName.Length > 0 ? productName : "Sản phẩm hoa",
                    ["customerName"] = name.Length == 0 || Regex.IsMatch(name, @"flower\s*flow|cửa hàng|quản trị|admin", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) ? "Khách hàng" : name,
                    ["rating"] = rating, ["comment"] = comment, ["createdAt"] = FieldValue.ServerTimestamp
                };
                transaction.CreateJs(reviewRef, data);
                for (var index = 0; index < photos.Count; index++)
                    transaction.CreateJs(db.Collection(FirestoreCollections.ReviewImages).Document($"{reviewRef.Id}_{index}"), new Dictionary<string, object>
                    { ["reviewId"] = reviewRef.Id, ["bytes"] = photos[index], ["createdAt"] = FieldValue.ServerTimestamp });
                return data;
            }, cancellationToken: context.RequestAborted);
            var response = new Dictionary<string, object>(review) { ["id"] = reviewRef.Id,
                ["createdAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) };
            context.Response.StatusCode = 201; await context.Response.WriteAsJsonAsync(new { review = FirestoreValues.JsonCompatible(response) }, context.RequestAborted);
        }
        catch (BackendException error) when (error.Code is "order-not-found" or "order-not-delivered" or "already-reviewed" or "invalid-argument")
        { await Error(context, error.Code == "order-not-found" ? 404 : error.Code == "invalid-argument" ? 400 : 409, error.Code, error.Message); }
        catch { logger.LogError("Review submission failed."); await Error(context, 503, "review-service-unavailable", "Chưa thể gửi đánh giá. Vui lòng thử lại sau."); }
    }
}
