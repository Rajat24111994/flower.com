namespace FlowerFlow.Infrastructure.Vnpay;

/// <summary>Reads the VNPay merchant configuration from the server environment (never from requests).</summary>
public sealed class VnpayGateway(Func<string, string?>? environmentReader = null) : IVnpayGateway
{
    private readonly Func<string, string?> environment = environmentReader ?? Environment.GetEnvironmentVariable;

    public VnpaySecrets GetSecrets()
    {
        var env = environment;
        var code = (env("VNPAY_TMN_CODE") ?? "").Trim();
        var secret = (env("VNPAY_HASH_SECRET") ?? "").Trim();
        if (code.Length == 0 || secret.Length == 0) throw new VnpayException("vnpay-not-configured", "Thiếu cấu hình VNPay trên máy chủ.");
        return new(code, secret);
    }

    public VnpayConfig GetConfig()
    {
        var env = environment;
        var secrets = GetSecrets();
        var modeValue = env("VNPAY_ENV");
        var mode = (string.IsNullOrEmpty(modeValue) ? "sandbox" : modeValue).Trim().ToLowerInvariant();
        if (mode is not ("sandbox" or "production")) throw new VnpayException("vnpay-not-configured", "Môi trường VNPay không hợp lệ.");
        if (!Uri.TryCreate(env("PUBLIC_APP_URL"), UriKind.Absolute, out var appUrl))
            throw new VnpayException("vnpay-not-configured", "Thiếu URL công khai của cửa hàng trong cấu hình máy chủ.");
        if (appUrl.Scheme != "https" && appUrl.Host != "localhost")
            throw new VnpayException("vnpay-not-configured", "URL công khai của cửa hàng phải dùng HTTPS.");
        return new(secrets.TmnCode, secrets.HashSecret, mode == "production" ? VnpayService.ProductionPaymentUrl : VnpayService.SandboxPaymentUrl,
            new Uri(appUrl, "/payment-result.html").AbsoluteUri);
    }
}
