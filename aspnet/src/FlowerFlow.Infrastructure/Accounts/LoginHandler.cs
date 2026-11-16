using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Infrastructure.Accounts;

/// <summary>Port of backend/accounts/login.js. Only a protected, successful password check can mint a custom token.</summary>
public sealed class LoginHandler(IFirebaseAccounts accounts, Func<IPasswordAuth> passwordProvider, Func<LoginProtection> protection)
{
    private static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["invalid-credential"] = "Email hoặc mật khẩu không chính xác.", ["account-locked"] = "Đăng nhập tạm thời bị khóa do nhiều lần thất bại.",
        ["password-reset-required"] = "Để bảo vệ tài khoản, vui lòng dùng Quên mật khẩu để đặt lại mật khẩu trước khi đăng nhập.",
        ["login-in-progress"] = "Một yêu cầu đăng nhập đang được xử lý. Vui lòng đợi rồi thử lại.",
        ["auth-service-unavailable"] = "Chưa thể đăng nhập lúc này. Vui lòng thử lại sau."
    };
    private static Task RespondAsync(HttpContext context, LoginProtectionResult result)
    {
        var body = new Dictionary<string, object>(); context.Response.StatusCode = result.Status;
        if (result.Code is not null)
        {
            body["code"] = result.Code;
            if (Messages.TryGetValue(result.Code, out var message)) body["error"] = message;
        }
        if (result.RetryAfter is > 0)
        {
            context.Response.Headers.RetryAfter = result.RetryAfter.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            body["retryAfter"] = result.RetryAfter.Value;
        }
        return context.Response.WriteAsJsonAsync(body, context.RequestAborted);
    }
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method != "POST")
        { context.Response.Headers.Allow = "POST"; await FirebaseAdminService.SendErrorAsync(context, 405, "method-not-allowed", "Phương thức không được hỗ trợ."); return; }
        var body = await JsonInput.ReadAsync(context); var rawEmail = Js.Get(body, "email");
        var email = Js.IsString(rawEmail) ? rawEmail.GetString()!.Trim().ToLowerInvariant() : ""; var password = Js.Get(body, "password");
        if (email.Length is < 1 or > 254 || !Regex.IsMatch(email, @"\A[^\s@]+@[^\s@]+\.[^\s@]+\z")
            || !Js.IsString(password) || password.GetString()!.Length is < 1 or > 4096)
        { await FirebaseAdminService.SendErrorAsync(context, 400, "invalid-argument", "Vui lòng nhập email và mật khẩu hợp lệ."); return; }
        LoginProtectionResult? attempt = null; LoginProtection? guard = null;
        // Node's password flow has its own provider timeout, not a client-disconnect signal.
        // Finish the serialized check even if the caller disconnects so failures cannot evade accounting.
        var policyCancellation = CancellationToken.None;
        try
        {
            accounts.EnsureConfigured(); var provider = passwordProvider(); guard = protection();
            await provider.AssertReadyAsync(policyCancellation);
            var account = await provider.LookupAsync(email, policyCancellation);
            attempt = await guard.AcquireAsync(account.Key, account.PasswordUpdatedAt, policyCancellation);
            if (attempt.Code is not null) { await RespondAsync(context, attempt); return; }
            var valid = await provider.VerifyPasswordAsync(email, password.GetString()!, account, policyCancellation);
            var result = await guard.FinishAsync(attempt, valid ? "success" : "invalid", policyCancellation); attempt = null;
            if (result.Status != 200) { await RespondAsync(context, result); return; }
            var token = await accounts.CreateCustomTokenAsync(account.Uid!, policyCancellation);
            await context.Response.WriteAsJsonAsync(new { customToken = token }, context.RequestAborted);
        }
        catch
        {
            if (attempt?.LeaseId is not null && guard is not null)
            {
                // Release an in-flight provider attempt without counting an outage as a wrong password.
                try { await guard.FinishAsync(attempt, "unavailable", CancellationToken.None); } catch { /* lease expires safely */ }
            }
            await RespondAsync(context, new(503, "auth-service-unavailable"));
        }
    }
}
