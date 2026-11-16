using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using static Flower.Api.Data;
using static Flower.Api.OrderRules;

namespace Flower.Api;

public static class Vnpay
{
    public static string Canonical(IDictionary<string, object> input) => string.Join("&", input.Where(p => p.Key.StartsWith("vnp_", StringComparison.Ordinal) && p.Key is not ("vnp_SecureHash" or "vnp_SecureHashType") && p.Value != null && Str(p.Value).Length > 0)
        .OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => Encode(p.Key) + "=" + Encode(Str(p.Value))));
    // URLSearchParams uses the application/x-www-form-urlencoded percent-encode set.
    private static string Encode(string text) => string.Concat(Encoding.UTF8.GetBytes(text).Select(b => b is >= 65 and <= 90 or >= 97 and <= 122 or >= 48 and <= 57 or 42 or 45 or 46 or 95 ? ((char)b).ToString() : b == 32 ? "+" : "%" + b.ToString("X2")));
    public static bool Verify(Dictionary<string, object> input, string secret)
    {
        var hash = input.S("vnp_SecureHash");
        if (!Regex.IsMatch(hash, "^[a-fA-F0-9]{128}$")) return false;
        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(hash), HMACSHA512.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(Canonical(input))));
    }
    public static (string Code, string Secret) Secrets(IConfiguration config)
    {
        var code = config["VNPAY_TMN_CODE"]?.Trim() ?? ""; var secret = config["VNPAY_HASH_SECRET"]?.Trim() ?? "";
        Require(code.Length > 0 && secret.Length > 0, "vnpay-not-configured", "Thanh toán VNPay chưa được cấu hình. Vui lòng chọn thanh toán khi nhận hàng hoặc thử lại sau.", 503);
        return (code, secret);
    }
    public static (string Code, string Secret, string Url, string Return) Config(IConfiguration config)
    {
        var secrets = Secrets(config); var mode = config["VNPAY_ENV"]?.Trim().ToLowerInvariant() ?? "sandbox";
        Require(mode is "sandbox" or "production" && Uri.TryCreate(config["PUBLIC_APP_URL"], UriKind.Absolute, out var _), "vnpay-not-configured", "Thanh toán VNPay chưa được cấu hình. Vui lòng chọn thanh toán khi nhận hàng hoặc thử lại sau.", 503);
        var app = new Uri(config["PUBLIC_APP_URL"]!);
        Require(app.Scheme == "https" || app.Host == "localhost", "vnpay-not-configured", "Thanh toán VNPay chưa được cấu hình. Vui lòng chọn thanh toán khi nhận hàng hoặc thử lại sau.", 503);
        return (secrets.Code, secrets.Secret, mode == "production" ? "https://pay.vnpay.vn/vpcpay.html" : "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html", new Uri(app, "/payment-result.html").ToString());
    }
    public static string Url(Dictionary<string, object> attempt, string ip, (string Code, string Secret, string Url, string Return) config)
    {
        var amount = attempt.N("amount"); var txn = attempt.S("txnRef");
        Require(Regex.IsMatch(txn, "^[A-Za-z0-9]{1,100}$") && Safe(amount) && amount > 0 && Safe(amount * 100) && amount * 100 <= 999999999999, "invalid-payment", "Thông tin giao dịch VNPay không hợp lệ.");
        var created = (Timestamp)attempt["createdAt"]; var expires = (Timestamp)attempt["expiresAt"];
        Require(expires > created, "invalid-payment", "Thời hạn thanh toán VNPay không hợp lệ.");
        var parameters = Map("vnp_Version", "2.1.0", "vnp_Command", "pay", "vnp_TmnCode", config.Code, "vnp_Amount", Str(amount * 100), "vnp_CurrCode", "VND", "vnp_TxnRef", txn, "vnp_OrderInfo", "Thanh toan Flowerflow " + txn, "vnp_OrderType", "other", "vnp_Locale", "vn", "vnp_ReturnUrl", config.Return, "vnp_IpAddr", IPAddress.TryParse(ip, out _) ? ip : "127.0.0.1", "vnp_CreateDate", Vietnam(created.ToDateTime()).ToString("yyyyMMddHHmmss"), "vnp_ExpireDate", Vietnam(expires.ToDateTime()).ToString("yyyyMMddHHmmss"));
        var query = Canonical(parameters); var signature = Convert.ToHexStringLower(HMACSHA512.HashData(Encoding.UTF8.GetBytes(config.Secret), Encoding.UTF8.GetBytes(query)));
        return config.Url + "?" + query + "&vnp_SecureHash=" + signature;
    }
}

public sealed class PaymentEndpoints(FirebaseServices firebase, OrderEndpoints orders, IConfiguration configuration)
{
    public async Task Handle(HttpContext context)
    {
        if (context.Request.Method == "GET" && context.Request.Query["action"] == "status")
        {
            var txn = context.Request.Query["txnRef"].ToString();
            Require(Regex.IsMatch(txn, "^[a-f0-9]{32}$"), "invalid-payment", "Mã giao dịch thanh toán không hợp lệ.");
            var snapshot = await firebase.Db.Collection("paymentTransactions").Document(txn).GetSnapshotAsync();
            Require(snapshot.Exists, "payment-not-found", "Không tìm thấy giao dịch thanh toán.", 404);
            var payment = Read(snapshot); var expired = payment.S("status") == "pending" && payment.Get("expiresAt") is Timestamp time && time <= Now();
            await context.Response.WriteAsJsonAsync(new { status = expired ? "expired" : payment.S("status"), orderId = payment.S("orderId"), retryAllowed = payment.S("status") != "success", latePayment = payment.B("latePayment") }); return;
        }
        var body = context.Request.Method == "POST" ? await Body(context) : new();
        if (context.Request.Method != "POST" || body.S("action") is not ("create" or "retry"))
        {
            context.Response.Headers.Allow = "GET, POST";
            throw Error("method-not-allowed", "API thanh toán chỉ chấp nhận GET hoặc POST.", 405);
        }
        var config = Vnpay.Config(configuration); var retry = body.S("action") == "retry"; var previous = retry ? body.S("txnRef") : "";
        Require(!retry || Regex.IsMatch(previous, "^[a-f0-9]{32}$"), "invalid-payment", "Mã giao dịch thanh toán không hợp lệ.");
        var id = retry ? "" : body.S("orderId").Trim(); var paymentReference = retry ? "" : body.S("paymentReference").Trim();
        Require(retry || id.Length is > 0 and <= 128 && !id.Contains('/') && paymentReference.Length is > 0 and <= 64, "invalid-payment", "Thông tin đơn hàng không hợp lệ.");
        var db = firebase.Db;
        if (retry)
        {
            var prior = await db.Collection("paymentTransactions").Document(previous).GetSnapshotAsync();
            Require(prior.Exists, "order-not-found", "Không tìm thấy giao dịch thanh toán.", 404);
            id = Read(prior).S("orderId");
        }
        var attempt = await Attempt(id, paymentReference, previous);
        var url = Vnpay.Url(attempt, context.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1", config);
        await context.Response.WriteAsJsonAsync(new { paymentUrl = url, expiresAt = Iso(attempt.Get("expiresAt")) });
    }
    public async Task<Dictionary<string, object>> Attempt(string id, string reference, string previous)
    {
        var db = firebase.Db; await orders.Expire(); var orderRef = db.Collection("orders").Document(id);
        return await db.RunTransactionAsync(async transaction =>
        {
            var snapshot = await transaction.GetSnapshotAsync(orderRef); var order = Read(snapshot);
            Require(snapshot.Exists, "order-not-found", "Không tìm thấy đơn hàng.", 404);
            if (previous.Length > 0)
            {
                var prior = await transaction.GetSnapshotAsync(db.Collection("paymentTransactions").Document(previous));
                Require(prior.Exists && Read(prior).S("orderId") == id, "order-not-found", "Không tìm thấy giao dịch thanh toán.", 404);
            }
            else Require(order.S("paymentReference") == reference, "order-not-found", "Không tìm thấy giao dịch thanh toán.", 404);
            Require(order.S("paymentMethod") == "vnpay", "payment-not-available", "Đơn hàng này không sử dụng thanh toán VNPay.", 409);
            Require(!order.B("paymentVerified"), "payment-already-complete", "Đơn hàng đã được xác nhận thanh toán.", 409);
            var now = Now(); var currentTxn = order.S("vnpTxnRef");
            if (currentTxn.Length > 0)
            {
                var current = Read(await transaction.GetSnapshotAsync(db.Collection("paymentTransactions").Document(currentTxn)));
                if (current.S("status") == "pending" && current.Get("expiresAt") is Timestamp expiry && expiry > now && order.B("inventoryReserved") && order.Get("reservationExpiresAt") is Timestamp reservation && reservation > now)
                    return Map("txnRef", currentTxn, "amount", current["amount"], "createdAt", current.Get("createdAt") ?? now, "expiresAt", expiry);
            }
            var items = Aggregate(order.Get("items")); var total = order.N("total");
            Require(items.Count > 0 && Safe(order.Get("total")) && Safe(total * 100) && total > 0, "invalid-payment", "Đơn hàng không có số tiền thanh toán hợp lệ.");
            var reserved = order.B("inventoryReserved");
            Require(reserved || order.S("status") == "Đã hủy" && order.S("paymentStatus") == "that_bai" && order.ContainsKey("reservationExpiredAt"), "payment-not-available", "Đơn hàng không còn ở trạng thái có thể thanh toán.", 409);
            var products = new List<DocumentSnapshot>();
            if (!reserved) foreach (var item in items) products.Add(await transaction.GetSnapshotAsync(db.Collection("products").Document(item.S("id"))));
            for (var i = 0; i < products.Count; i++) Require(products[i].Exists && Safe(Read(products[i]).N("quantity")) && Read(products[i]).N("quantity") >= items[i].N("quantity"), "insufficient-stock", "Một số sản phẩm đã hết hàng. Hãy quay lại giỏ hàng để cập nhật đơn.", 409);
            var txn = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)); var expires = reserved && order.Get("reservationExpiresAt") is Timestamp end && end > now ? end : Timestamp.FromDateTime(now.ToDateTime().AddMinutes(15));
            var number = Math.Max(0, order.N("vnpPaymentAttempt")) + 1;
            for (var i = 0; i < products.Count; i++) transaction.Update(products[i].Reference, Map("quantity", Read(products[i]).N("quantity") - items[i].N("quantity")));
            transaction.Create(db.Collection("paymentTransactions").Document(txn), Map("orderId", id, "amount", total, "status", "pending", "attempt", number, "createdAt", now, "expiresAt", expires));
            var update = Map("paymentStatus", "chua_thanh_toan", "vnpTxnRef", txn, "vnpPaymentAttempt", number, "vnpPaymentCreatedAt", FieldValue.ServerTimestamp);
            if (!reserved)
            {
                var history = Arr(order.Get("trackingHistory")); history.Add(Map("status", "Chờ xác nhận", "location", "Đơn hàng đang chờ thanh toán lại", "estimatedDelivery", "", "updatedAt", Iso(now)));
                foreach (var pair in Map("status", "Chờ xác nhận", "currentLocation", "Đơn hàng đang chờ thanh toán lại", "inventoryReserved", true, "inventoryState", "reserved", "reservationExpiresAt", expires, "reservationExpiredAt", FieldValue.Delete, "trackingHistory", history)) update[pair.Key] = pair.Value;
            }
            transaction.Update(orderRef, update);
            return Map("txnRef", txn, "amount", total, "createdAt", now, "expiresAt", expires);
        });
    }
    private static Dictionary<string, object> Reply(string code, string message) => Map("RspCode", code, "Message", message);
    public async Task Ipn(HttpContext context)
    {
        if (context.Request.Method != "GET") { context.Response.Headers.Allow = "GET"; throw Error("method-not-allowed", "VNPay IPN chỉ chấp nhận GET.", 405); }
        (string Code, string Secret) secrets;
        try { secrets = Vnpay.Secrets(configuration); }
        catch { await context.Response.WriteAsJsonAsync(Reply("99", "Configuration error")); return; }
        // Reject duplicate parameters instead of joining attacker-controlled values.
        if (context.Request.Query.Any(p => p.Value.Count != 1)) { await context.Response.WriteAsJsonAsync(Reply("97", "Invalid signature")); return; }
        var input = context.Request.Query.ToDictionary(p => p.Key, p => (object)p.Value.ToString());
        if (!Vnpay.Verify(input, secrets.Secret) || input.S("vnp_TmnCode") != secrets.Code) { await context.Response.WriteAsJsonAsync(Reply("97", "Invalid signature")); return; }
        var txn = input.S("vnp_TxnRef");
        if (!Regex.IsMatch(txn, "^[a-f0-9]{32}$")) { await context.Response.WriteAsJsonAsync(Reply("01", "Order not found")); return; }
        try
        {
            var db = firebase.Db; await orders.Expire(); var attemptRef = db.Collection("paymentTransactions").Document(txn);
            var result = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(attemptRef); var attempt = Read(snapshot);
                if (!snapshot.Exists || attempt.Get("orderId") is not string || attempt.S("orderId").Length == 0 || !Safe(attempt.Get("amount")) || attempt.N("amount") <= 0 || !Safe(attempt.N("amount") * 100)) return Reply("01", "Order not found");
                var orderRef = db.Collection("orders").Document(attempt.S("orderId")); var orderSnapshot = await transaction.GetSnapshotAsync(orderRef); var order = Read(orderSnapshot);
                if (!orderSnapshot.Exists || order.S("paymentMethod") != "vnpay") return Reply("01", "Order not found");
                var amountText = input.S("vnp_Amount"); var amount = Num(amountText);
                if (input.S("vnp_CurrCode") != "VND" || !Regex.IsMatch(amountText, "^\\d+$") || !Safe(amount) || amount != attempt.N("amount") * 100 || !Safe(order.Get("total")) || !Safe(order.N("total") * 100) || amount != order.N("total") * 100) return Reply("04", "Invalid amount");
                if (attempt.S("status") == "success") return Reply("00", "Confirm Success");
                var paid = input.S("vnp_ResponseCode") == "00" && input.S("vnp_TransactionStatus") == "00"; var late = paid && (!order.B("inventoryReserved") || order.S("status") == "Đã hủy");
                var update = Map("status", paid ? "success" : "failed", "responseCode", input.S("vnp_ResponseCode"), "transactionStatus", input.S("vnp_TransactionStatus"), "transactionNo", Cut(input.S("vnp_TransactionNo"), 100), "processedAt", FieldValue.ServerTimestamp);
                if (late) update["latePayment"] = true;
                transaction.Update(attemptRef, update);
                if (paid && !order.B("paymentVerified"))
                {
                    var changes = Map("paymentStatus", "da_thanh_toan", "paymentVerified", true, "paidAt", Iso(Now()), "vnpTransactionNo", Cut(input.S("vnp_TransactionNo"), 100), "vnpTxnRef", txn);
                    if (late) { changes["latePayment"] = true; changes["paymentAttention"] = "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."; }
                    transaction.Update(orderRef, changes);
                }
                else if (!paid && !order.B("paymentVerified") && order.S("vnpTxnRef") == txn) transaction.Update(orderRef, Map("paymentStatus", "that_bai", "vnpResponseCode", Cut(input.S("vnp_ResponseCode"), 10)));
                else if (paid && order.B("paymentVerified"))
                {
                    transaction.Update(attemptRef, Map("latePayment", true));
                    transaction.Update(orderRef, Map("latePayment", true, "paymentAttention", "Có thêm giao dịch VNPay thành công cho đơn đã thanh toán; cần kiểm tra và xử lý hoàn tiền."));
                }
                return Reply("00", "Confirm Success");
            });
            await context.Response.WriteAsJsonAsync(result);
        }
        catch { await context.Response.WriteAsJsonAsync(Reply("99", "Unknown error")); }
    }
}
