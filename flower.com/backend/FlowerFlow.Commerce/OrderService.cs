using System.Security.Cryptography;
using System.Text;
using FlowerFlow.Domain.Rules;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public sealed class OrderService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public async Task<CreatedOrder> CreateAsync(CheckoutRequest request, CancellationToken ct = default)
    {
        InputValidation.Validate(request);
        var normalized = OrderValidationService.ValidateCheckout(ShoppingService.Json(request));
        if (normalized is null) throw new CommerceException(400, "invalid-checkout", "Thông tin đặt hàng không hợp lệ.");
        var idempotencyKey = (string)normalized["idempotencyKey"];
        var normalizedItems = ShoppingService.NormalizedItems(normalized);
        var promotionId = (string)normalized["promotionId"];
        var zoneId = (string)normalized["deliveryZoneId"];
        // Cleanup is a separate transaction; a rejected checkout cannot undo released holds.
        await ExpireAsync(ct);
        var fingerprint = Hash(ShoppingService.Json(new { checkout = normalized, orderNote = request.OrderNote?.Trim() ?? "" }).GetRawText());
        return await work.ExecuteAsync(async (session, token) =>
        {
            var key = await session.Repository<OrderRequestKey>().FindAsync(idempotencyKey, token);
            if (key is not null)
            {
                if (key.UserId != actor.UserId || key.RequestHash != fingerprint)
                    throw CommerceException.Conflict("idempotency-conflict", "Mã yêu cầu đã được dùng cho nội dung khác.");
                var existing = await session.Repository<Order>().FindAsync(key.OrderId, token) ?? throw CommerceException.Missing("đơn hàng");
                return new CreatedOrder(existing.Id, existing.PaymentReference, existing.Totals);
            }
            var now = time.GetUtcNow();
            var error = OrderValidationService.DeliveryScheduleError((string)normalized["deliveryDate"], (string)normalized["deliveryTime"], now);
            if (error.Length > 0) throw new CommerceException(400, "invalid-delivery-schedule", error);
            if (actor.UserId.Length == 0 && normalizedItems.GroupBy(item => item.ProductId ?? item.Id).Any(group => group.Sum(item => item.Quantity) > 5))
                throw new CommerceException(400, "guest-quantity-limit", "Khách chưa đăng nhập đặt tối đa 5 sản phẩm mỗi loại.");
            await ConsumeLimitAsync(session, "create:ip:" + actor.ClientKey, 5, TimeSpan.FromMinutes(15), now, token);
            await ConsumeLimitAsync(session, "create:phone:" + OrderValidationService.NormalizePhone(request.Phone), 3, TimeSpan.FromMinutes(15), now, token);
            if (actor.UserId.Length > 0) await ConsumeLimitAsync(session, "create:user:" + actor.UserId, 5, TimeSpan.FromMinutes(15), now, token);
            var quote = await ShoppingService.BuildQuoteAsync(session, new(normalizedItems, promotionId, zoneId), now, token);
            if (quote.Totals != request.ExpectedTotals) throw CommerceException.Conflict("price-changed", "Giá hoặc ưu đãi đã thay đổi. Hãy kiểm tra báo giá mới.");
            if (quote.DeliveryZone is null) throw new CommerceException(400, "invalid-delivery-zone", "Cần chọn khu vực giao hàng.");
            await ChangeStockAsync(session, quote.Items, reserve: true, token);
            var customer = new CustomerDetails((string)normalized["customerName"], (string)normalized["phone"], (string)normalized["address"],
                (string)normalized["recipientName"], (string)normalized["recipientPhone"], (bool)normalized["customerIsRecipient"],
                (string)normalized["deliveryDate"], (string)normalized["deliveryTime"], (string)normalized["greetingCard"],
                (bool)normalized["anonymousGreetingCard"], (string)normalized["giftWrap"], request.OrderNote?.Trim() ?? "");
            var duration = request.PaymentMethod == "vnpay" ? OrderConfig.VnpayReservationMs
                : request.PaymentMethod == "qr" ? OrderConfig.QrReservationMs : OrderConfig.CodReservationMs;
            var order = new Order(Guid.NewGuid().ToString("N"), actor.UserId, customer, quote.Items.ToArray(), quote.Totals,
                new DeliveryZone(quote.DeliveryZone.Id, quote.DeliveryZone.Province, quote.DeliveryZone.District, quote.DeliveryZone.Fee, quote.DeliveryZone.Enabled),
                promotionId, request.PaymentMethod, PricingService.PaymentReferenceFor(idempotencyKey),
                "Chờ xác nhận", "reserved", now.AddMilliseconds(duration), false,
                request.PaymentMethod == "qr" ? "Chờ xác minh thanh toán" : request.PaymentMethod == "vnpay" ? "chua_thanh_toan" : "Thanh toán khi nhận hàng",
                false, [new("Chờ xác nhận", "Đơn hàng đã được gửi đến cửa hàng", "", now)], now);
            await session.Repository<Order>().PutAsync(order, token);
            await session.Repository<OrderRequestKey>().PutAsync(new(idempotencyKey, actor.UserId, fingerprint, order.Id), token);
            await AuditAsync(session, "order.create", order.Id, now, token);
            return new CreatedOrder(order.Id, order.PaymentReference, order.Totals);
        }, ct);
    }

    public Task<IReadOnlyList<Order>> ListAsync(bool manage = false, CancellationToken ct = default)
    {
        if (manage) CommerceAccess.Admin(actor); else CommerceAccess.Customer(actor);
        return work.ExecuteAsync<IReadOnlyList<Order>>(async (session, token) => (await session.Repository<Order>().ListAsync(token))
            .Where(order => manage || order.UserId == actor.UserId).OrderByDescending(order => order.CreatedAt).Take(100).Select(Copy).ToArray(), ct);
    }
    public Task<Order> GetAsync(string id, CancellationToken ct = default) => work.ExecuteAsync(async (session, token) =>
    {
        var order = await session.Repository<Order>().FindAsync(id, token) ?? throw CommerceException.Missing("đơn hàng");
        CommerceAccess.OwnOrAdmin(actor, order.UserId); return Copy(order);
    }, ct);

    public async Task<TrackingResponse> TrackAsync(TrackOrderRequest request, CancellationToken ct = default)
    {
        InputValidation.Validate(request);
        // Commit limiter even when the subsequent lookup fails; attackers cannot bypass it with wrong phones.
        await work.ExecuteAsync(async (session, token) =>
        { await ConsumeLimitAsync(session, "lookup:" + actor.ClientKey, 20, TimeSpan.FromMinutes(10), time.GetUtcNow(), token); return true; }, ct);
        return await work.ExecuteAsync(async (session, token) =>
        {
            var order = await session.Repository<Order>().FindAsync(request.OrderId, token);
            if (order is null || OrderValidationService.NormalizePhone(order.Customer.Phone) != OrderValidationService.NormalizePhone(request.Phone))
                throw CommerceException.Missing("đơn hàng");
            var qr = order.PaymentMethod == "qr" && !order.PaymentVerified && !order.PaymentRefunded && order.Status is "Chờ xác nhận" or "Đang chuẩn bị";
            // Public tracking excludes name, phone, address and internal location.
            return new TrackingResponse(order.Id, order.Status, order.History.Select(item => item with { Location = "" }).ToArray(),
                order.PaymentMethod, order.PaymentRefunded ? "Đã hoàn tiền" : order.PaymentStatus,
                qr ? order.Totals.Total : null, qr ? order.PaymentReference : null, qr ? order.ReservationExpiresAt : null);
        }, ct);
    }

    public Task<Order> ChangeStatusAsync(string id, OrderStatusRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor); InputValidation.Validate(request);
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<Order>(); var order = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("đơn hàng");
            if (order.Version != request.ExpectedVersion) throw CommerceException.Conflict("version-conflict", "Đơn hàng đã thay đổi.");
            if (!OrderStatusRules.CanTransition(order.Status, request.Status)) throw CommerceException.Conflict("invalid-order-transition", "Phải cập nhật trạng thái theo đúng thứ tự.");
            if (request.Status == "Đang giao" && (string.IsNullOrWhiteSpace(request.Location) || string.IsNullOrWhiteSpace(request.EstimatedDelivery)))
                throw new CommerceException(400, "invalid-tracking", "Cần vị trí và thời gian dự kiến giao.");
            var state = order.InventoryState;
            var reserveAgain = order.Status == "Đã hủy" && request.Status == "Chờ xác nhận" && state == "released";
            if (request.Status == "Đã hủy" && (state == "reserved" || state == "sold" && request.RestockSold))
            { await ChangeStockAsync(session, order.Items, reserve: false, token); state = "released"; }
            if (order.Status == "Đã hủy" && request.Status == "Chờ xác nhận" && state == "released")
            { await ChangeStockAsync(session, order.Items, reserve: true, token); state = "reserved"; }
            if (request.Status != "Đã hủy") state = request.Status == "Đã giao" ? "sold" : "reserved";
            var now = time.GetUtcNow(); var codPaid = request.Status == "Đã giao" && order.PaymentMethod == "cod" && !order.PaymentRefunded;
            var salesDelta = request.Status == "Đã giao" && !order.SalesCounted ? 1
                : request.Status == "Đã hủy" && request.RestockSold && order.SalesCounted ? -1 : 0;
            if (salesDelta != 0)
                foreach (var group in order.Items.GroupBy(item => item.ProductId))
                {
                    var product = (await session.Repository<Product>().FindAsync(group.Key, token))!;
                    await session.Repository<Product>().PutAsync(product with
                    { SoldCount = Math.Max(0, checked(product.SoldCount + salesDelta * group.Sum(item => item.Quantity))), Version = product.Version + 1 }, token);
                }
            var duration = order.PaymentMethod == "vnpay" ? OrderConfig.VnpayReservationMs : OrderConfig.QrReservationMs;
            var updated = order with { Status = request.Status, InventoryState = state,
                ReservationExpiresAt = request.Status != "Chờ xác nhận" || order.PaymentVerified ? null
                    : reserveAgain ? now.AddMilliseconds(duration) : order.ReservationExpiresAt,
                ReservationExpired = reserveAgain ? false : order.ReservationExpired,
                SalesCounted = salesDelta == 0 ? order.SalesCounted : salesDelta > 0,
                PaymentVerified = order.PaymentVerified || codPaid, PaymentStatus = codPaid ? "Đã thanh toán"
                    : reserveAgain && order.PaymentMethod == "qr" ? order.PaymentVerified ? "Đã thanh toán" : "Chờ xác minh thanh toán" : order.PaymentStatus,
                History = order.History.Append(new(request.Status, request.Location ?? "", request.EstimatedDelivery ?? "", now)).ToArray(), Version = order.Version + 1 };
            await repository.PutAsync(updated, token); await AuditAsync(session, "order.status", id, now, token); return Copy(updated);
        }, ct);
    }

    public Task<int> ExpireAsync(CancellationToken ct = default) => work.ExecuteAsync((session, token) => ExpireSessionAsync(session, time.GetUtcNow(), token), ct);
    internal static async Task<int> ExpireSessionAsync(ICommerceSession session, DateTimeOffset now, CancellationToken ct)
    {
        var count = 0;
        foreach (var order in await session.Repository<Order>().ListAsync(ct))
        {
            if (order.ReservationExpiresAt is null || order.ReservationExpiresAt > now) continue;
            if (order.Status != "Chờ xác nhận" || order.PaymentVerified || order.PaymentRefunded || order.InventoryState != "reserved")
            { await session.Repository<Order>().PutAsync(order with { ReservationExpiresAt = null, Version = order.Version + 1 }, ct); continue; }
            await ChangeStockAsync(session, order.Items, false, ct);
            await session.Repository<Order>().PutAsync(order with { Status = "Đã hủy", InventoryState = "released", ReservationExpiresAt = null,
                PaymentStatus = order.PaymentMethod == "qr" ? "Hết hạn chờ thanh toán" : order.PaymentMethod == "vnpay" ? "that_bai" : order.PaymentStatus,
                ReservationExpired = true,
                History = order.History.Append(new("Đã hủy", "Đơn hàng hết thời hạn giữ sản phẩm", "", now)).ToArray(), Version = order.Version + 1 }, ct);
            foreach (var attempt in (await session.Repository<PaymentAttempt>().ListAsync(ct)).Where(item => item.OrderId == order.Id && item.Status == "pending"))
                await session.Repository<PaymentAttempt>().PutAsync(attempt with { Status = "expired" }, ct);
            count++;
        }
        return count;
    }
    internal static async Task ChangeStockAsync(ICommerceSession session, IReadOnlyList<PricedLine> items, bool reserve, CancellationToken ct)
    {
        foreach (var group in items.GroupBy(item => item.ProductId))
        {
            var product = await session.Repository<Product>().FindAsync(group.Key, ct) ?? throw CommerceException.Missing("sản phẩm");
            var quantity = group.Sum(item => item.Quantity);
            if (reserve && (product.Status == "hidden" || product.Quantity < quantity)) throw CommerceException.Conflict("insufficient-stock", "Không đủ tồn kho.");
            var updated = (long)product.Quantity + (reserve ? -quantity : quantity);
            if (updated > ProductRules.MaxSafeInteger) throw CommerceException.Conflict("stock-overflow", "Tồn kho vượt giới hạn.");
            await session.Repository<Product>().PutAsync(product with { Quantity = updated, Version = product.Version + 1 }, ct);
        }
    }
    internal static async Task ConsumeLimitAsync(ICommerceSession session, string key, int maximum, TimeSpan window, DateTimeOffset now, CancellationToken ct)
    {
        var id = Hash(key); var repository = session.Repository<RequestLimit>(); var old = await repository.FindAsync(id, ct);
        var count = old is not null && old.ExpiresAt > now ? old.Count : 0;
        if (count >= maximum) throw new CommerceException(429, "order-rate-limited", "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.")
        { RetryAfter = Math.Max(1, (int)Math.Ceiling((old!.ExpiresAt - now).TotalSeconds)) };
        await repository.PutAsync(new(id, count + 1, old is not null && old.ExpiresAt > now ? old.ExpiresAt : now.Add(window)), ct);
    }
    private Task AuditAsync(ICommerceSession session, string action, string id, DateTimeOffset now, CancellationToken ct) =>
        session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId, action, id, now), ct);
    internal static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static Order Copy(Order order) => order with { Items = order.Items.ToArray(), History = order.History.ToArray() };
}
