using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FlowerFlow.Application.Payments;

public sealed class VnpayException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
public sealed record VnpaySecrets(string TmnCode, string HashSecret);
public sealed record VnpayConfig(string TmnCode, string HashSecret, string PaymentUrl, string ReturnUrl);

/// <summary>Port of backend/payments/vnpay.js, including WHATWG form query encoding used by the signature.</summary>
public static class VnpayService
{
    public const string SandboxPaymentUrl = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
    public const string ProductionPaymentUrl = "https://pay.vnpay.vn/vpcpay.html";

    public static string FormatVietnamDate(DateTimeOffset date) =>
        TimeZoneInfo.ConvertTime(date, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"))
            .ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

    public static string CanonicalQuery(JsonObject parameters) => string.Join("&", parameters
        .Where(pair => pair.Key.StartsWith("vnp_", StringComparison.Ordinal)
            && pair.Key is not ("vnp_SecureHash" or "vnp_SecureHashType") && pair.Value is not null && StringValue(pair.Value) != "")
        .OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => FormEncode(pair.Key) + "=" + FormEncode(StringValue(pair.Value))));

    public static string CreatePaymentUrl(string txnRef, double amount, string? ipAddress,
        DateTimeOffset createdAt, DateTimeOffset expiresAt, VnpayConfig config)
    {
        if (!Regex.IsMatch(txnRef, @"\A[A-Za-z0-9]{1,100}\z") || !double.IsFinite(amount) || amount != Math.Truncate(amount)
            || amount <= 0 || amount * 100 > 999999999999)
            throw new VnpayException("invalid-payment", "Thông tin giao dịch VNPay không hợp lệ.");
        if (expiresAt <= createdAt) throw new VnpayException("invalid-payment", "Thời hạn thanh toán VNPay không hợp lệ.");
        var parameters = new JsonObject
        {
            ["vnp_Version"] = "2.1.0", ["vnp_Command"] = "pay", ["vnp_TmnCode"] = config.TmnCode,
            ["vnp_Amount"] = (amount * 100).ToString("0", CultureInfo.InvariantCulture), ["vnp_CurrCode"] = "VND",
            ["vnp_TxnRef"] = txnRef, ["vnp_OrderInfo"] = $"Thanh toan Flowerflow {txnRef}", ["vnp_OrderType"] = "other",
            ["vnp_Locale"] = "vn", ["vnp_ReturnUrl"] = config.ReturnUrl,
            ["vnp_IpAddr"] = IsIp(ipAddress) ? ipAddress : "127.0.0.1", ["vnp_CreateDate"] = FormatVietnamDate(createdAt),
            ["vnp_ExpireDate"] = FormatVietnamDate(expiresAt)
        };
        var query = CanonicalQuery(parameters);
        var hash = HMACSHA512.HashData(Encoding.UTF8.GetBytes(config.HashSecret), Encoding.UTF8.GetBytes(query));
        return config.PaymentUrl + "?" + query + "&vnp_SecureHash=" + Convert.ToHexStringLower(hash);
    }

    public static bool VerifySignature(JsonObject parameters, string hashSecret)
    {
        var actual = StringValue(parameters["vnp_SecureHash"]).ToLowerInvariant();
        if (!Regex.IsMatch(actual, @"\A[a-f0-9]{128}\z")) return false;
        var expected = HMACSHA512.HashData(Encoding.UTF8.GetBytes(hashSecret), Encoding.UTF8.GetBytes(CanonicalQuery(parameters)));
        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), expected);
    }

    private static string FormEncode(string value)
    {
        var result = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            if (b is >= (byte)'a' and <= (byte)'z' or >= (byte)'A' and <= (byte)'Z' or >= (byte)'0' and <= (byte)'9'
                or (byte)'*' or (byte)'-' or (byte)'.' or (byte)'_') result.Append((char)b);
            else if (b == ' ') result.Append('+');
            else result.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
        }
        return result.ToString();
    }

    private static string StringValue(JsonNode? value) => value switch
    {
        null => "", JsonArray array => string.Join(",", array.Select(StringValue)), JsonObject => "[object Object]",
        JsonValue scalar when scalar.TryGetValue<string>(out var text) => text,
        _ => value.ToJsonString()
    };

    private static bool IsIp(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Contains('[') || value.Contains(']') || value != value.Trim()) return false;
        if (!IPAddress.TryParse(value, out var address)) return false;
        if (address.AddressFamily == AddressFamily.InterNetworkV6) return true;
        var parts = value.Split('.');
        return parts.Length == 4 && parts.All(part => byte.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var b)
            && part == b.ToString(CultureInfo.InvariantCulture));
    }
}
