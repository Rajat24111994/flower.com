using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Application.Commerce;

public sealed record ReviewRequest([Required] string OrderId, [Range(1, 5)] int Rating,
    [Required, StringLength(1000)] string Comment, [Required, MaxLength(3)] string[] Photos);
public sealed record ReviewModerationRequest([Required, RegularExpression("^(pending|approved|hidden)$")] string Status,
    [Range(1, long.MaxValue)] long ExpectedVersion, [StringLength(500)] string Reason = "", [StringLength(1000)] string Reply = "");
public sealed record ReviewResponse(string Id, string CustomerName, IReadOnlyList<string> ProductIds,
    int Rating, string Comment, IReadOnlyList<string> PhotoUrls, string ModerationStatus, string Reply, DateTimeOffset CreatedAt, long Version);

public sealed class ReviewService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public Task<ReviewResponse> CreateAsync(ReviewRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Customer(actor); InputValidation.Validate(request);
        if (ImageRules.ValidateReviewPhotos(ShoppingService.Json(request.Photos)) is null)
            throw new CommerceException(400, "invalid-photos", "Tối đa 3 ảnh JPEG, mỗi ảnh tối đa 120 KB và 1600px.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var order = await session.Repository<Order>().FindAsync(request.OrderId, token);
            if (order is null || order.UserId != actor.UserId) throw CommerceException.Missing("đơn hàng");
            if (order.Status != "Đã giao") throw CommerceException.Conflict("order-not-delivered", "Chỉ đánh giá đơn đã giao.");
            var id = OrderService.Hash("review:" + order.Id)[..40]; var repository = session.Repository<Review>();
            if (await repository.FindAsync(id, token) is not null) throw CommerceException.Conflict("already-reviewed", "Mỗi đơn chỉ được đánh giá một lần.");
            var name = order.Customer.Name.Trim();
            if (name.Length == 0 || Regex.IsMatch(name, "flower\\s*flow|cửa hàng|quản trị|admin", RegexOptions.IgnoreCase)) name = "Khách hàng";
            var review = new Review(id, order.Id, actor.UserId, name[..Math.Min(name.Length, 80)],
                order.Items.Select(item => item.ProductId).Distinct().Take(10).ToArray(), request.Rating, request.Comment.Trim(),
                request.Photos.ToArray(), "pending", "", "", time.GetUtcNow());
            await repository.PutAsync(review, token); return Response(review);
        }, ct);
    }

    public Task<IReadOnlyList<ReviewResponse>> ListAsync(string? productId = null, bool manage = false, CancellationToken ct = default)
    {
        if (manage) CommerceAccess.Admin(actor);
        return work.ExecuteAsync<IReadOnlyList<ReviewResponse>>(async (session, token) => (await session.Repository<Review>().ListAsync(token))
            .Where(item => manage || item.ModerationStatus == "approved")
            .Where(item => productId is null || item.ProductIds.Contains(productId)).OrderByDescending(item => item.CreatedAt).Take(100).Select(Response).ToArray(), ct);
    }
    public Task<ReviewResponse?> OwnAsync(string orderId, CancellationToken ct = default)
    {
        CommerceAccess.Customer(actor);
        return work.ExecuteAsync(async (session, token) =>
        {
            var order = await session.Repository<Order>().FindAsync(orderId, token);
            if (order is null || order.UserId != actor.UserId) throw CommerceException.Missing("đơn hàng");
            var review = await session.Repository<Review>().FindAsync(OrderService.Hash("review:" + orderId)[..40], token);
            return review is null ? null : Response(review);
        }, ct);
    }
    public Task<ReviewResponse> ModerateAsync(string id, ReviewModerationRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Review>(); var review = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("đánh giá");
            if (review.Version != request.ExpectedVersion) throw CommerceException.Conflict("version-conflict", "Đánh giá đã thay đổi.");
            var updated = review with { ModerationStatus = request.Status, ModerationReason = request.Reason ?? "", Reply = request.Reply ?? "", Version = review.Version + 1 };
            await repository.PutAsync(updated, token);
            await session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId, "review.moderate", id, time.GetUtcNow()), token);
            return Response(updated);
        }, ct);
    }
    public Task<byte[]> PhotoAsync(string id, int index, CancellationToken ct = default) => work.ExecuteAsync(async (session, token) =>
    {
        var review = await session.Repository<Review>().FindAsync(id, token) ?? throw CommerceException.Missing("ảnh");
        if (review.ModerationStatus != "approved" && actor.UserId != review.AuthorId && actor.Role is not ("admin" or "owner"))
            throw CommerceException.Missing("ảnh");
        if (index < 0 || index >= review.Photos.Count) throw CommerceException.Missing("ảnh");
        return Convert.FromBase64String(review.Photos[index].Split(',')[1]);
    }, ct);
    private static ReviewResponse Response(Review review) => new(review.Id, review.CustomerName, review.ProductIds.ToArray(),
        review.Rating, review.Comment, review.Photos.Select((_, index) => $"/api/v1/reviews/{review.Id}/photos/{index}").ToArray(),
        review.ModerationStatus, review.Reply, review.CreatedAt, review.Version);
}
