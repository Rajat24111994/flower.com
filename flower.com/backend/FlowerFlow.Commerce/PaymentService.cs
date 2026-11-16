using System.ComponentModel.DataAnnotations;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed record ReconciliationRequest([Range(1, 9_007_199_254_740_991)] long Amount,
    [Required, StringLength(120)] string Reference, bool LatePayment = false);
public sealed record RefundRequest([Required, StringLength(120)] string Reference);
public sealed record SimulatePaymentRequest([Required, RegularExpression("^(paid|failed)$")] string Outcome,
    [Range(1, 9_007_199_254_740_991)] long Amount, [Required, StringLength(120)] string ProviderReference);
public sealed record GatewaySession(string Reference, string Provider);

/// <summary>Production implementations must verify provider signatures before delivering a result.
/// No real provider credentials or outgoing payment requests are used at this stage.</summary>
public interface IPaymentGateway
{
    Task<GatewaySession> CreateAsync(string paymentId, long amount, CancellationToken cancellationToken);
}

public sealed class PaymentService(ICommerceUnitOfWork work, ICurrentActor actor, IPaymentGateway gateway, TimeProvider time)
{
    public async Task<PaymentAttempt> CreateAttemptAsync(string orderId, CancellationToken ct = default, string? paymentReference = null)
    {
        await work.ExecuteAsync((session, token) => OrderService.ExpireSessionAsync(session, time.GetUtcNow(), token), ct);
        return await work.ExecuteAsync(async (session, token) =>
        {
            var order = await session.Repository<Order>().FindAsync(orderId, token) ?? throw CommerceException.Missing("đơn hàng");
            AuthorizeOrder(order, paymentReference);
            if (order.PaymentMethod != "vnpay") throw CommerceException.Conflict("payment-method-mismatch", "Đơn không sử dụng cổng thanh toán.");
            if (order.PaymentVerified || order.PaymentRefunded || order.Totals.Total <= 0 || order.Totals.Total > ProductRules.MaxSafeInteger / 100)
                throw CommerceException.Conflict("payment-unavailable", "Đơn hàng không còn chờ thanh toán.");
            var retryExpired = order.Status == "Đã hủy" && order.ReservationExpired && order.PaymentStatus == "that_bai" && order.InventoryState == "released";
            if (!retryExpired && (order.InventoryState != "reserved" || order.Status == "Đã hủy"))
                throw CommerceException.Conflict("payment-unavailable", "Đơn hàng không còn chờ thanh toán.");
            if (retryExpired)
            {
                await OrderService.ChangeStockAsync(session, order.Items, true, token);
                order = order with { Status = "Chờ xác nhận", InventoryState = "reserved", ReservationExpired = false,
                    ReservationExpiresAt = time.GetUtcNow().AddMinutes(15), Version = order.Version + 1,
                    History = order.History.Append(new("Chờ xác nhận", "Đơn hàng đang chờ thanh toán lại", "", time.GetUtcNow())).ToArray() };
                await session.Repository<Order>().PutAsync(order, token);
            }
            var existing = (await session.Repository<PaymentAttempt>().ListAsync(token)).FirstOrDefault(item => item.OrderId == orderId && item.Status == "pending" && item.ExpiresAt > time.GetUtcNow());
            if (existing is not null) return existing;
            var id = Guid.NewGuid().ToString("N");
            var provider = await gateway.CreateAsync(id, order.Totals.Total, token);
            var attempt = new PaymentAttempt(id, orderId, order.Totals.Total, "pending", provider.Reference, time.GetUtcNow(), order.ReservationExpiresAt ?? time.GetUtcNow().AddMinutes(15));
            await session.Repository<PaymentAttempt>().PutAsync(attempt, token);
            await session.Repository<Order>().PutAsync(order with { CurrentPaymentId = id, PaymentStatus = "chua_thanh_toan", Version = order.Version + 1 }, token);
            return attempt;
        }, ct);
    }

    public Task<PaymentAttempt> GetAttemptAsync(string id, CancellationToken ct = default, string? paymentReference = null) => work.ExecuteAsync(async (session, token) =>
    {
        var attempt = await session.Repository<PaymentAttempt>().FindAsync(id, token) ?? throw CommerceException.Missing("thanh toán");
        var order = await session.Repository<Order>().FindAsync(attempt.OrderId, token) ?? throw CommerceException.Missing("đơn hàng");
        AuthorizeOrder(order, paymentReference);
        return attempt.Status == "pending" && attempt.ExpiresAt <= time.GetUtcNow() ? attempt with { Status = "expired" } : attempt;
    }, ct);

    public async Task<PaymentAttempt> RetryAsync(string id, CancellationToken ct = default, string? paymentReference = null)
    {
        var previous = await GetAttemptAsync(id, ct, paymentReference);
        return await CreateAttemptAsync(previous.OrderId, ct, paymentReference);
    }

    // Only the local owner-only simulator invokes this in the new host. A future real webhook
    // needs its own authenticated adapter; never expose this as an unsigned public callback.
    public Task<PaymentAttempt> SimulateAsync(string id, SimulatePaymentRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor); InputValidation.Validate(request); ValidateReference(request.ProviderReference);
        return work.ExecuteAsync(async (session, token) =>
        {
            var attempts = session.Repository<PaymentAttempt>(); var attempt = await attempts.FindAsync(id, token) ?? throw CommerceException.Missing("thanh toán");
            if (attempt.Amount != request.Amount) throw CommerceException.Conflict("payment-amount-mismatch", "Số tiền không khớp.");
            if (attempt.Status == "paid" || attempt.Status == "failed" && request.Outcome == "failed")
            {
                if (attempt.Status == request.Outcome && attempt.ProviderReference == request.ProviderReference) return attempt;
                throw CommerceException.Conflict("payment-result-conflict", "Giao dịch đã có kết quả khác.");
            }
            var orders = session.Repository<Order>(); var order = await orders.FindAsync(attempt.OrderId, token) ?? throw CommerceException.Missing("đơn hàng");
            var now = time.GetUtcNow();
            await OrderService.ExpireSessionAsync(session, now, token);
            order = (await orders.FindAsync(order.Id, token))!;
            var late = request.Outcome == "paid" && (order.Status == "Đã hủy" || order.InventoryState != "reserved" || order.PaymentVerified);
            if (request.Outcome == "paid" && order.PaymentVerified)
                order = order with { PaymentAttention = "Có thêm giao dịch thành công; cần kiểm tra và hoàn tiền nếu cần.", Version = order.Version + 1 };
            else if (request.Outcome == "paid")
                order = order with { PaymentVerified = true, PaymentStatus = order.Status == "Đã hủy"
                    ? "Đã nhận tiền sau khi đơn bị hủy – cần khôi phục đơn hoặc hoàn tiền" : "Đã thanh toán",
                    PaymentAttention = late ? "Thanh toán đến sau khi đơn đã hủy; cần khôi phục đơn hoặc hoàn tiền." : "",
                    ReservationExpiresAt = null, Version = order.Version + 1 };
            else if (!order.PaymentVerified && order.CurrentPaymentId == attempt.Id)
                order = order with { PaymentStatus = "that_bai", Version = order.Version + 1 };
            var result = attempt with { Status = request.Outcome, ProviderReference = request.ProviderReference, LatePayment = late };
            await attempts.PutAsync(result, token); await orders.PutAsync(order, token);
            await Audit(session, order, "gateway." + request.Outcome, request.ProviderReference, token); return result;
        }, ct);
    }

    public Task<PaymentAudit> ReconcileQrAsync(string orderId, ReconciliationRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request); ValidateReference(request.Reference);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Order>(); var order = await repository.FindAsync(orderId, token) ?? throw CommerceException.Missing("đơn hàng");
            if (order.PaymentMethod != "qr") throw CommerceException.Conflict("payment-method-mismatch", "Đơn không dùng QR.");
            if (order.PaymentVerified || order.PaymentRefunded) throw CommerceException.Conflict("payment-already-complete", "Đơn đã được đối soát.");
            if (request.Amount != order.Totals.Total) throw CommerceException.Conflict("payment-amount-mismatch", "Số tiền không khớp.");
            if (request.LatePayment != (order.Status == "Đã hủy")) throw CommerceException.Conflict("order-status-mismatch", "Cần chọn đúng thao tác thanh toán thông thường hoặc thanh toán trễ.");
            if (!request.LatePayment && order.InventoryState == "released") throw CommerceException.Conflict("order-inventory-released", "Đơn đã giải phóng tồn kho.");
            await repository.PutAsync(order with { PaymentVerified = true, ReservationExpiresAt = null, Version = order.Version + 1,
                PaymentStatus = request.LatePayment ? "Đã nhận tiền sau khi đơn bị hủy – cần khôi phục đơn hoặc hoàn tiền" : "Đã thanh toán" }, token);
            return await Audit(session, order, request.LatePayment ? "qr-late-payment-recorded" : "qr-payment-verified", request.Reference, token);
        }, ct);
    }

    public Task<PaymentAudit> RefundAsync(string orderId, RefundRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request); ValidateReference(request.Reference);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Order>(); var order = await repository.FindAsync(orderId, token) ?? throw CommerceException.Missing("đơn hàng");
            if (order.PaymentRefunded) throw CommerceException.Conflict("payment-already-refunded", "Đã ghi nhận hoàn tiền.");
            if (!order.PaymentVerified || order.Totals.Total <= 0) throw CommerceException.Conflict("payment-not-complete", "Đơn chưa xác nhận thanh toán.");
            await repository.PutAsync(order with { PaymentRefunded = true, PaymentStatus = "Đã hoàn tiền", Version = order.Version + 1 }, token);
            // Recording a refund does not cancel an order or restore stock implicitly.
            return await Audit(session, order, "payment-refunded", request.Reference, token);
        }, ct);
    }
    public Task<IReadOnlyList<PaymentAudit>> HistoryAsync(string orderId, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        return work.ExecuteAsync<IReadOnlyList<PaymentAudit>>(async (session, token) => (await session.Repository<PaymentAudit>().ListAsync(token))
            .Where(item => item.OrderId == orderId).OrderByDescending(item => item.CreatedAt).Take(25).ToArray(), ct);
    }
    private async Task<PaymentAudit> Audit(ICommerceSession session, Order order, string action, string reference, CancellationToken ct)
    {
        var audit = new PaymentAudit(Guid.NewGuid().ToString("N"), order.Id, action, actor.UserId, order.Totals.Total, reference.Trim(), time.GetUtcNow());
        await session.Repository<PaymentAudit>().PutAsync(audit, ct);
        await session.Repository<AuditEntry>().PutAsync(new(audit.Id, actor.UserId, action, order.Id, audit.CreatedAt), ct);
        return audit;
    }
    private static void ValidateReference(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Any(char.IsControl)) throw new CommerceException(400, "invalid-reference", "Mã giao dịch không hợp lệ.");
    }
    private void AuthorizeOrder(Order order, string? reference)
    {
        if (actor.Role is "admin" or "owner" || actor.UserId.Length > 0 && actor.UserId == order.UserId) return;
        if (string.IsNullOrEmpty(reference) || reference != order.PaymentReference) throw CommerceException.Missing("đơn hàng");
    }
}
