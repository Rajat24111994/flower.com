using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using FirebaseAdmin.Auth;
using Google.Cloud.Firestore;
using static Flower.Api.Data;
using static Flower.Api.OrderRules;

namespace Flower.Api;

public sealed class OrderEndpoints(FirebaseServices firebase, IConfiguration configuration, ILogger<OrderEndpoints> logger)
{
    private static readonly JsonSerializerOptions HashJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Reference(string key) => "FF" + key.Replace("-", "")[..12].ToUpperInvariant();
    public static string ReviewId(string order) => Hash("review:" + order)[..40];
    private static bool Id(string id) => id.Length is > 0 and <= 128 && !id.Contains('/');
    public async Task<FirebaseToken?> Optional(HttpContext context) => Regex.IsMatch(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+(.+)$", RegexOptions.IgnoreCase) ? await firebase.Verify(context) : null;
    private async Task<FirebaseToken> Admin(HttpContext context)
    {
        var user = await firebase.Verify(context);
        Require(UserEndpoints.IsAdmin(user.Claims), "forbidden", "Thao tác này chỉ dành cho quản trị viên.", 403);
        Require((await firebase.Db.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync()).Exists, "forbidden", "Quyền quản trị viên đã bị thu hồi.", 403);
        return user;
    }
    public async Task Handle(HttpContext context)
    {
        if (context.Request.Method == "POST")
        {
            var body = await Body(context);
            switch (body.S("action"))
            {
                case "quote": await Checkout(context, body, false); break;
                case "lookup": await Lookup(context, body); break;
                case "verify-qr-payment": await Reconcile(context, body, false, false); break;
                case "record-late-qr-payment": await Reconcile(context, body, true, false); break;
                case "record-payment-refund": await Reconcile(context, body, false, true); break;
                case "review": await Review(context, body, false); break;
                case "review-get": await Review(context, body, true); break;
                default: await Checkout(context, body, true); break;
            }
            return;
        }
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = "GET, POST";
            throw Error("method-not-allowed", "API đơn hàng chỉ chấp nhận phương thức GET hoặc POST.", 405);
        }
        if (context.Request.Query["action"] == "expire")
        {
            var bearer = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+(.+)$", RegexOptions.IgnoreCase);
            var secret = configuration["CRON_SECRET"];
            var allowed = !string.IsNullOrEmpty(secret) && bearer.Success && bearer.Groups[1].Value == secret;
            if (!allowed && bearer.Success)
            {
                try { allowed = UserEndpoints.IsAdmin((await firebase.Verify(context)).Claims); } catch { }
            }
            Require(allowed, "unauthenticated", "Quyền dọn đơn hết hạn không hợp lệ.", 401);
            await context.Response.WriteAsJsonAsync(new { released = await Expire() });
            return;
        }
        if (context.Request.Query["action"] == "payment-audit")
        {
            var orderId = context.Request.Query["orderId"].ToString().Trim();
            Require(Id(orderId), "invalid-argument", "Mã đơn không hợp lệ.");
            await Admin(context);
            var query = await firebase.Db.Collection("orderPaymentAudit").WhereEqualTo("orderId", orderId).OrderByDescending("createdAt").Limit(25).GetSnapshotAsync();
            var keys = new[] { "action", "actorUid", "actorEmail", "actorRole", "amountVnd", "paymentReference", "reconciliationReference", "previousPaymentStatus", "orderStatus", "createdAt" };
            await context.Response.WriteAsJsonAsync(new { entries = query.Documents.Select(doc => { var data = doc.ToDictionary(); var row = Map("id", doc.Id); foreach (var key in keys) if (data.ContainsKey(key)) row[key] = key == "createdAt" ? Iso(data[key]) : data[key]; return row; }) });
            return;
        }
        throw Error("method-not-allowed", "Tra cứu đơn hàng cần dùng phương thức POST.", 405);
    }
    public async Task<int> Expire(int max = 500)
    {
        var db = firebase.Db; var released = 0; var scanned = 0;
        while (released < max && scanned < max)
        {
            var now = Now();
            var query = await db.Collection("orders").WhereEqualTo("inventoryReserved", true).WhereLessThanOrEqualTo("reservationExpiresAt", now).OrderBy("reservationExpiresAt").Limit(Math.Min(100, max - scanned)).GetSnapshotAsync();
            if (query.Count == 0) break;
            scanned += query.Count;
            foreach (var snapshot in query.Documents)
            {
                if (await db.RunTransactionAsync(async transaction =>
                {
                    var orderSnapshot = await transaction.GetSnapshotAsync(snapshot.Reference);
                    if (!orderSnapshot.Exists) return false;
                    var order = orderSnapshot.ToDictionary();
                    if (order.B("inventoryReserved") && order.S("status") != "Chờ xác nhận" && order.ContainsKey("reservationExpiresAt"))
                    {
                        transaction.Update(snapshot.Reference, Map("reservationExpiresAt", FieldValue.Delete)); return false;
                    }
                    if (!order.B("inventoryReserved") || order.Get("reservationExpiresAt") is not Timestamp expiry || expiry > now) return false;
                    if (order.B("paymentVerified") || new[] { "đã thanh toán", "paid", "da_thanh_toan", "đã hoàn tiền" }.Contains(order.S("paymentStatus").Trim().ToLowerInvariant()))
                    {
                        transaction.Update(snapshot.Reference, Map("reservationExpiresAt", FieldValue.Delete)); return false;
                    }
                    var items = Aggregate(order.Get("items"));
                    DocumentSnapshot? payment = null;
                    if (order.S("paymentMethod") == "vnpay" && order.S("vnpTxnRef").Length > 0) payment = await transaction.GetSnapshotAsync(db.Collection("paymentTransactions").Document(order.S("vnpTxnRef")));
                    var restore = order.S("status") != "Đã giao";
                    var products = new List<DocumentSnapshot>();
                    if (restore) foreach (var item in items) products.Add(await transaction.GetSnapshotAsync(db.Collection("products").Document(item.S("id"))));
                    for (var i = 0; i < products.Count; i++) if (products[i].Exists) transaction.Update(products[i].Reference, Map("quantity", Read(products[i]).N("quantity") + items[i].N("quantity")));
                    var status = restore ? "Đã hủy" : order.S("status"); var location = restore ? "Đơn hàng hết thời hạn giữ sản phẩm" : order.S("currentLocation");
                    var history = Arr(order.Get("trackingHistory")); history.Add(Map("status", status, "location", location, "estimatedDelivery", "", "updatedAt", Iso(now)));
                    var update = Map("status", status, "currentLocation", location, "inventoryReserved", false, "inventoryState", restore ? "released" : "sold", "reservationExpiredAt", now, "trackingUpdatedAt", now, "trackingHistory", history);
                    if (order.S("paymentMethod") == "qr") update["paymentStatus"] = "Hết hạn chờ thanh toán";
                    if (order.S("paymentMethod") == "vnpay") { update["paymentStatus"] = "that_bai"; update["vnpResponseCode"] = "expired"; }
                    transaction.Update(snapshot.Reference, update);
                    if (payment?.Exists == true && Read(payment).S("status") == "pending") transaction.Update(payment.Reference, Map("status", "expired", "processedAt", now));
                    return true;
                })) released++;
            }
        }
        return released;
    }
    private async Task Cleanup()
    {
        try { await Expire(); } catch { logger.LogWarning("Reservation cleanup failed"); }
    }
    private async Task Checkout(HttpContext context, Dictionary<string, object> body, bool create)
    {
        Require(!create || body.S("orderNote").Trim().Length <= 500, "note-too-long", "Ghi chú tối đa 500 ký tự. Hãy rút gọn ghi chú rồi đặt lại.");
        Require(!Rows(body.Get("items")).Any(i => i.N("quantity") > 50), "quantity-limit", "Mỗi lựa chọn bó hoa đặt tối đa 50 bó. Hãy giảm số lượng, hoặc liên hệ cửa hàng nếu cần số lượng lớn.");
        var checkout = Validate(body, create);
        Require(checkout != null, "invalid-checkout", create ? "Thông tin đặt hàng hoặc danh sách sản phẩm không hợp lệ." : "Danh sách sản phẩm không hợp lệ.");
        var input = checkout!; var user = create ? await Optional(context) : null; var db = firebase.Db;
        await Cleanup();
        var items = Rows(input.Get("items")); var uid = user?.Uid ?? "";
        var hashInput = new Dictionary<string, object>(input) { ["orderNote"] = body.S("orderNote").Trim(), ["uid"] = uid };
        var requestHash = Hash(JsonSerializer.Serialize(hashInput, HashJson));
        Dictionary<string, object> BuildCart(List<DocumentSnapshot> snapshots, bool quoting)
        {
            var cart = new List<Dictionary<string, object>>(); var shortages = new List<Dictionary<string, object>>(); var hidden = new List<string>();
            for (var i = 0; i < items.Count; i++)
            {
                var data = Read(snapshots[i]); var price = Vnd(data.Get("price")); var stock = data.ContainsKey("quantity") ? data.N("quantity") : double.NaN; var title = data.S("title", "Một sản phẩm");
                if (data.S("status") == "hidden") hidden.Add($"“{Cut(title, 120)}”");
                if (!quoting)
                {
                    Require(snapshots[i].Exists, "product-unavailable", "Một sản phẩm không còn bán.", 409);
                    Require(data.S("status") != "hidden", "product-unavailable", $"“{Cut(title, 120)}” hiện đang tạm ẩn và không thể đặt hàng.", 409);
                    Require(price > 0, "product-unavailable", $"“{title}” hiện chưa có giá bán. Hãy bỏ sản phẩm này khỏi giỏ.", 409);
                }
                if (!snapshots[i].Exists || price <= 0 || !Safe(stock) || stock < Demand(items, ProductId(items[i])))
                {
                    var available = snapshots[i].Exists && Safe(stock) && price > 0 ? Math.Max(0, stock) : 0;
                    if (!quoting) throw Error("insufficient-stock", available > 0 ? $"“{title}” vừa có người mua, chỉ còn {available} sản phẩm. Hãy giảm số lượng rồi đặt lại." : $"“{title}” vừa hết hàng. Hãy bỏ sản phẩm này khỏi giỏ.");
                    shortages.Add(Map("id", items[i].S("id"), "title", Cut(data.S("title"), 120), "available", available));
                }
                var line = new Dictionary<string, object>(items[i]) { ["data"] = data, ["price"] = price, ["stock"] = stock };
                cart.Add(line);
            }
            if (quoting && hidden.Count > 0) return Map("code", "product-unavailable", "error", string.Join(", ", hidden) + " hiện đang tạm ẩn và không thể đặt hàng. Hãy chọn sản phẩm khác.");
            if (quoting && shortages.Count > 0) return Map("code", "insufficient-stock", "error", string.Join("; ", shortages.Select(i => i.N("available") > 0 ? $"“{i.S("title", "Một sản phẩm") }” chỉ còn {i.N("available")} sản phẩm" : $"“{i.S("title", "Một sản phẩm") }” đã hết hàng")) + ". Hãy giảm số lượng hoặc xóa sản phẩm đó khỏi giỏ.", "items", shortages);
            return Map("cart", cart);
        }
        var productRefs = items.Select(i => db.Collection("products").Document(ProductId(i))).ToArray();
        if (!create)
        {
            var products = await db.GetAllSnapshotsAsync(productRefs);
            var promotions = Read(await db.Document("metadata/activePromotions").GetSnapshotAsync());
            var delivery = Read(await db.Document("metadata/deliveryZones").GetSnapshotAsync());
            var wrapping = Read(await db.Document("metadata/bouquetWrapping").GetSnapshotAsync());
            var zone = Delivery(delivery, input.S("deliveryZoneId"));
            var built = BuildCart(products.ToList(), true);
            if (built.ContainsKey("code")) { context.Response.StatusCode = 409; await context.Response.WriteAsJsonAsync(built); return; }
            var cart = Rows(built.Get("cart")); var promotion = Promotion(promotions.Get("items"), input.S("promotionId")); var bouquets = Bouquets(cart, wrapping.Get("tiers"));
            var totals = Totals(cart, promotion, bouquets.Sum(b => b.N("wrappingFee")), zone?.N("fee") ?? 0);
            var publicZone = zone == null ? null : Map("id", zone.S("id"), "province", zone.S("province"), "district", zone.S("district"), "fee", zone.N("fee"));
            await context.Response.WriteAsJsonAsync(new { totals, customBouquets = bouquets, deliveryZone = publicZone, deliveryZonesConfigured = EnabledZones(delivery).Count > 0, items = cart.Select(Line) });
            return;
        }
        var requestRef = db.Collection("orderRequests").Document(input.S("idempotencyKey")); var now = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).UtcDateTime;
        var order = await db.RunTransactionAsync(async transaction =>
        {
            var previous = await transaction.GetSnapshotAsync(requestRef);
            if (previous.Exists)
            {
                var data = Read(previous);
                Require(data.S("uid") == uid && (data.S("requestHash").Length == 0 || data.S("requestHash") == requestHash), "idempotency-conflict", "Mã yêu cầu đã được dùng cho nội dung đặt hàng khác. Hãy kiểm tra đơn đã gửi.", 409);
                var existing = await transaction.GetSnapshotAsync(db.Collection("orders").Document(data.S("orderId")));
                Require(existing.Exists, "idempotency-conflict", "Yêu cầu đặt hàng này đã được xử lý nhưng đơn không còn tồn tại.", 409);
                var saved = Read(existing); saved["id"] = existing.Id; return saved;
            }
            var schedule = Schedule(input.S("deliveryDate"), input.S("deliveryTime"));
            Require(schedule.Length == 0, "invalid-delivery-schedule", schedule);
            var products = new List<DocumentSnapshot>(); foreach (var reference in productRefs) products.Add(await transaction.GetSnapshotAsync(reference));
            var promotions = Read(await transaction.GetSnapshotAsync(db.Document("metadata/activePromotions")));
            var delivery = Read(await transaction.GetSnapshotAsync(db.Document("metadata/deliveryZones")));
            var wrapping = Read(await transaction.GetSnapshotAsync(db.Document("metadata/bouquetWrapping")));
            var zone = Delivery(delivery, input.S("deliveryZoneId"))!;
            var cart = Rows(BuildCart(products, false).Get("cart")); var promotion = Promotion(promotions.Get("items"), input.S("promotionId")); var bouquets = Bouquets(cart, wrapping.Get("tiers"));
            var totals = Totals(cart, promotion, bouquets.Sum(b => b.N("wrappingFee")), zone.N("fee")); var expected = Obj(input.Get("expectedTotals"));
            Require(totals.All(pair => Num(pair.Value) == expected.N(pair.Key)), "price-changed", "Giá hoặc ưu đãi vừa thay đổi. Hãy quay lại trang thanh toán để xem tổng tiền mới.", 409);
            var orderRef = db.Collection("orders").Document(); var payment = input.S("paymentMethod"); var referenceCode = Reference(input.S("idempotencyKey"));
            var dataOrder = new Dictionary<string, object>(input);
            dataOrder.Remove("expectedTotals"); dataOrder.Remove("idempotencyKey");
            foreach (var pair in totals) dataOrder[pair.Key] = pair.Value;
            var extra = Map("orderType", cart.Any(i => Obj(i.Get("data")).S("saleType") == "flower") ? "custom_bouquet" : "ready_made", "uid", uid, "deliveryProvince", zone.S("province"), "deliveryDistrict", zone.S("district"), "createdAt", FieldValue.ServerTimestamp, "status", "Chờ xác nhận", "currentLocation", "Đơn hàng đã được gửi đến cửa hàng", "estimatedDelivery", "", "trackingHistory", new[] { Map("status", "Chờ xác nhận", "location", "Đơn hàng đã được gửi đến cửa hàng", "estimatedDelivery", "", "updatedAt", Iso(Timestamp.FromDateTime(now))) }, "customBouquets", bouquets, "paymentStatus", payment == "qr" ? "Chờ xác minh thanh toán" : payment == "vnpay" ? "chua_thanh_toan" : "Thanh toán khi nhận hàng", "paymentReference", referenceCode, "paidAt", "", "paymentVerified", false, "promotionId", promotion == null ? "" : input.S("promotionId"), "orderNote", body.S("orderNote").Trim(), "items", cart.Select(Line).ToList(), "inventoryReserved", true, "inventoryState", "reserved", "reservationExpiresAt", Timestamp.FromDateTime(now.AddMinutes(payment == "qr" ? 30 : payment == "vnpay" ? 15 : 1440)));
            foreach (var pair in extra) dataOrder[pair.Key] = pair.Value;
            var seen = new HashSet<string>();
            for (var i = 0; i < cart.Count; i++) if (seen.Add(ProductId(cart[i]))) transaction.Update(productRefs[i], Map("quantity", cart[i].N("stock") - Demand(items, ProductId(cart[i]))));
            transaction.Create(orderRef, dataOrder);
            transaction.Create(requestRef, Map("orderId", orderRef.Id, "requestHash", requestHash, "uid", uid, "createdAt", FieldValue.ServerTimestamp));
            dataOrder["id"] = orderRef.Id;
            return dataOrder;
        });
        context.Response.StatusCode = 201;
        await context.Response.WriteAsJsonAsync(new { order = new { id = order.S("id"), paymentReference = order.S("paymentReference") }, totals = Map("subtotal", order.N("subtotal"), "savings", order.N("savings"), "wrappingFee", order.N("wrappingFee"), "shippingFee", order.N("shippingFee"), "total", order.N("total")) });
    }
    public static Dictionary<string, object> PublicTracking(string id, Dictionary<string, object> data)
    {
        var result = Map("id", id, "status", data.S("status", "Chờ xác nhận"), "estimatedDelivery", data.S("estimatedDelivery"), "trackingHistory", Rows(data.Get("trackingHistory")).Select(e => Map("status", e.S("status", data.S("status", "Chờ xác nhận")), "estimatedDelivery", e.S("estimatedDelivery"), "updatedAt", Iso(e.Get("updatedAt")))).ToList(), "privacyLimited", true);
        if (data.B("paymentRefunded")) { result["paymentMethod"] = data.S("paymentMethod"); result["paymentStatus"] = "Đã hoàn tiền"; }
        else if (data.S("paymentMethod") == "qr" && !data.B("paymentVerified") && new[] { "Chờ xác nhận", "Đang chuẩn bị" }.Contains(data.S("status", "Chờ xác nhận")))
        {
            foreach (var pair in Map("paymentMethod", "qr", "paymentStatus", data.S("paymentStatus", "Chờ xác minh thanh toán"), "total", data.N("total"), "wrappingFee", data.N("wrappingFee"), "paymentReference", data.S("paymentReference"), "reservationExpiresAt", Iso(data.Get("reservationExpiresAt")))) result[pair.Key] = pair.Value;
        }
        else if (data.S("paymentMethod") == "vnpay") { result["paymentMethod"] = "vnpay"; result["paymentStatus"] = data.S("paymentStatus", "chua_thanh_toan"); }
        return result;
    }
    private async Task Lookup(HttpContext context, Dictionary<string, object> body)
    {
        // RemoteIpAddress is the socket peer, never a caller-supplied forwarding header.
        // Configure trusted proxy processing explicitly at deployment before changing it.
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? throw new InvalidOperationException();
        var secret = configuration["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? throw new InvalidOperationException();
        var key = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(ip)));
        var db = firebase.Db; var reference = db.Collection("orderLookupLimits").Document(key); var now = Now();
        var retry = await db.RunTransactionAsync(async transaction =>
        {
            var record = Read(await transaction.GetSnapshotAsync(reference));
            var started = record.Get("windowStartedAt") is Timestamp timestamp ? timestamp.ToDateTime() : DateTime.UnixEpoch;
            var same = (now.ToDateTime() - started).TotalMinutes < 10; var attempts = same ? record.N("attempts") : 0;
            if (attempts >= 20) return Math.Max(1, (int)Math.Ceiling((started.AddMinutes(10) - now.ToDateTime()).TotalSeconds));
            transaction.Set(reference, Map("windowStartedAt", same ? record["windowStartedAt"] : now, "attempts", attempts + 1, "expiresAt", Timestamp.FromDateTime(now.ToDateTime().AddDays(1)))); return 0;
        });
        if (retry > 0) { context.Response.Headers.RetryAfter = retry.ToString(); throw Error("rate-limited", "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau.", 429); }
        var authorization = context.Request.Headers.Authorization.ToString().Trim();
        Require(authorization.Length == 0 || Regex.IsMatch(authorization, @"^Bearer\s+\S+$", RegexOptions.IgnoreCase), "unauthenticated", "Phiên đăng nhập không hợp lệ.", 401);
        var user = authorization.Length > 0 ? await Optional(context) : null;
        var id = body.S("id").Trim().TrimStart('#'); var phone = Phone(body.S("phone"));
        Require(Id(id) && (user != null || phone.Length is >= 8 and <= 15), "invalid-argument", "Mã đơn hàng hoặc số điện thoại không hợp lệ.");
        var snapshot = await db.Collection("orders").Document(id).GetSnapshotAsync(); var data = Read(snapshot);
        Require(snapshot.Exists && (user != null ? data.S("uid") == user.Uid : Phone(data.S("phone")) == phone), "order-not-found", user != null ? "Không tìm thấy đơn hàng trong tài khoản." : "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại.", 404);
        if (user != null) { data["id"] = id; data["createdAt"] = Iso(data.Get("createdAt")); data["reservationExpiresAt"] = Iso(data.Get("reservationExpiresAt")); data["trackingHistory"] = Rows(data.Get("trackingHistory")); }
        await context.Response.WriteAsJsonAsync(new { order = JsonSafe(user != null ? data : PublicTracking(id, data)) });
    }
    private async Task Reconcile(HttpContext context, Dictionary<string, object> body, bool late, bool refund)
    {
        var id = body.S("orderId").Trim(); var reference = body.S(refund ? "refundReference" : "reconciliationReference").Trim(); var amount = body.N("amount");
        Require(Id(id) && reference.Length is > 0 and <= 120 && !Regex.IsMatch(reference, @"[\x00-\x1f\x7f]") && (refund || Safe(amount) && amount > 0), "invalid-argument", refund ? "Cần mã đơn và mã giao dịch hoàn tiền hợp lệ." : "Cần mã đơn, mã giao dịch ngân hàng và số tiền đã đối chiếu hợp lệ.");
        var user = await Admin(context); var db = firebase.Db; var orderRef = db.Collection("orders").Document(id); var auditRef = db.Collection("orderPaymentAudit").Document();
        var total = await db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(orderRef); var order = Read(snapshot);
            Require(snapshot.Exists, "order-not-found", "Không tìm thấy đơn hàng.", 404);
            var previous = order.S("paymentStatus"); var paid = order.B("paymentVerified") || new[] { "đã thanh toán", "paid", "da_thanh_toan" }.Contains(previous.Trim().ToLowerInvariant());
            var update = new Dictionary<string, object>();
            if (refund)
            {
                Require(!order.B("paymentRefunded"), "payment-already-refunded", "Đơn hàng này đã được ghi nhận hoàn tiền.", 409);
                Require(paid, "payment-not-complete", "Chỉ ghi nhận hoàn tiền cho đơn đã xác nhận thanh toán.", 409);
                Require(Safe(order.Get("total")) && order.N("total") > 0, "invalid-refund-amount", "Tổng tiền đơn hàng không hợp lệ để hoàn tiền.", 409);
                update = Map("paymentRefunded", true, "paymentRefundAmount", order.N("total"), "paymentRefundedAt", FieldValue.ServerTimestamp, "paymentRefundedBy", user.Uid, "paymentRefundReference", reference, "paymentStatus", "Đã hoàn tiền");
            }
            else
            {
                Require(order.S("paymentMethod") == "qr", "payment-method-mismatch", "Đơn hàng này không sử dụng chuyển khoản QR.", 409);
                Require(!order.B("paymentVerified"), "payment-already-complete", "Thanh toán của đơn này đã được xác nhận.", 409);
                Require(Safe(order.Get("total")) && order.N("total") > 0 && amount == order.N("total"), "payment-amount-mismatch", "Số tiền đối chiếu không khớp tổng tiền đơn hàng.", 409);
                Require(late ? order.S("status") == "Đã hủy" : order.S("status") != "Đã hủy", late ? "order-not-cancelled" : "order-cancelled", late ? "Đơn này chưa bị hủy. Hãy dùng xác minh thanh toán thông thường." : "Đơn này đã bị hủy. Hãy dùng thao tác ghi nhận thanh toán trễ.", 409);
                Require(late || order.S("inventoryState") != "released", "order-inventory-released", "Đơn đã giải phóng tồn kho. Hãy khôi phục đơn trước khi xác nhận thanh toán.", 409);
                update = Map("paymentVerified", true, "paymentStatus", late ? "Đã nhận tiền sau khi đơn bị hủy – cần khôi phục đơn hoặc hoàn tiền" : "Đã thanh toán", "paidAt", Iso(Now()), "paymentVerifiedAt", FieldValue.ServerTimestamp, "paymentVerifiedBy", user.Uid, "paymentReconciliationReference", reference);
                if (late) { update["latePayment"] = true; update["paymentAttention"] = "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."; }
            }
            transaction.Update(orderRef, update);
            transaction.Create(auditRef, Map("orderId", id, "action", refund ? "payment-refunded" : late ? "qr-late-payment-recorded" : "qr-payment-verified", "actorUid", user.Uid, "actorEmail", Cut(user.Claims.TryGetValue("email", out var email) ? Str(email) : "", 254), "actorRole", "admin", "amountVnd", order.N("total"), "paymentReference", Cut(order.S("paymentReference"), 120), "reconciliationReference", reference, "previousPaymentStatus", Cut(previous, 120), "orderStatus", Cut(order.S("status"), 80), "createdAt", FieldValue.ServerTimestamp));
            return order.N("total");
        });
        var result = Map("ok", true, "auditId", auditRef.Id); if (refund) result["amountVnd"] = total;
        await context.Response.WriteAsJsonAsync(result);
    }
    private async Task Review(HttpContext context, Dictionary<string, object> body, bool get)
    {
        var id = body.S("orderId").Trim();
        if (!get) Require(Regex.IsMatch(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+(.+)$", RegexOptions.IgnoreCase), "unauthenticated", "Đăng nhập tài khoản đã đặt đơn để gửi đánh giá.", 401);
        var photos = ImageEndpoints.Photos(body.ContainsKey("photos") ? body.Get("photos") : new List<object>());
        if (!get) Require(photos != null, "invalid-photos", "Tối đa 3 ảnh JPEG đã tối ưu, mỗi ảnh không quá 120 KB và 1600px.");
        var rating = body.N("rating"); var comment = body.S("comment").Trim();
        Require(Id(id) && (get || Safe(rating) && rating is >= 1 and <= 5 && comment.Length is > 0 and <= 1000), "invalid-argument", get ? "Mã đơn không hợp lệ." : "Hãy chọn số sao và nhập nhận xét (tối đa 1000 ký tự).");
        var user = await Optional(context);
        Require(user != null, "unauthenticated", "Đăng nhập để xem đánh giá của bạn.", 401);
        var db = firebase.Db; var orderRef = db.Collection("orders").Document(id); var reviewRef = db.Collection("reviews").Document(ReviewId(id));
        if (get)
        {
            var order = Read(await orderRef.GetSnapshotAsync());
            Require(order.S("uid") == user!.Uid, "order-not-found", "Không tìm thấy đơn trong tài khoản.", 404);
            var snapshot = await reviewRef.GetSnapshotAsync(); var review = Read(snapshot); review["id"] = snapshot.Id; review["orderId"] = id; review["createdAt"] = Iso(review.Get("createdAt"));
            await context.Response.WriteAsJsonAsync(new { review = snapshot.Exists ? JsonSafe(review) : null }); return;
        }
        var created = await db.RunTransactionAsync(async transaction =>
        {
            var order = Read(await transaction.GetSnapshotAsync(orderRef)); var previous = await transaction.GetSnapshotAsync(reviewRef);
            Require(order.S("uid").Length > 0 && order.S("uid") == user!.Uid, "order-not-found", "Không tìm thấy đơn hàng này trong tài khoản của bạn.", 404);
            Require(order.S("status") == "Đã giao", "order-not-delivered", "Chỉ có thể đánh giá đơn hàng đã giao.", 409);
            Require(!previous.Exists, "already-reviewed", "Bạn đã đánh giá đơn hàng này rồi.", 409);
            var items = Rows(order.Get("items")); var ids = Aggregate(items).Select(i => i.S("id")).Where(s => s.Length > 0).Take(10).ToList();
            Require(ids.Count > 0, "invalid-argument", "Đơn hàng không có thông tin sản phẩm để gắn đánh giá.");
            var name = Cut(order.S("customerName").Trim(), 80); var productName = Cut(string.Join(", ", items.Select(i => i.S("title")).Where(s => s.Length > 0)), 500);
            var data = Map("authorUid", user!.Uid, "verifiedPurchase", true, "moderationStatus", "pending", "photoIds", photos!.Select((_, i) => $"{reviewRef.Id}_{i}").ToList(), "productIds", ids, "productName", productName.Length > 0 ? productName : "Sản phẩm hoa", "customerName", name.Length == 0 || Regex.IsMatch(name, @"flower\s*flow|cửa hàng|quản trị|admin", RegexOptions.IgnoreCase) ? "Khách hàng" : name, "rating", rating, "comment", comment, "createdAt", FieldValue.ServerTimestamp);
            transaction.Create(reviewRef, data);
            for (var i = 0; i < photos!.Count; i++) transaction.Create(db.Collection("reviewImages").Document($"{reviewRef.Id}_{i}"), Map("reviewId", reviewRef.Id, "bytes", photos[i], "createdAt", FieldValue.ServerTimestamp));
            return data;
        });
        created["id"] = reviewRef.Id; created["createdAt"] = Iso(Now()); context.Response.StatusCode = 201;
        await context.Response.WriteAsJsonAsync(new { review = created });
    }
}
