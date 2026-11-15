using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Infrastructure.Local;

public sealed class LocalAuthHandler(ILocalAccountWorker accounts, LocalRateLimit? limit = null)
{
    private readonly LocalRateLimit _limit = limit ?? new();
    private static readonly HashSet<string> Actions = ["register", "login", "reset", "session", "logout", "questions", "recover-pin", "change-pin", "setup-security"];
    private static readonly Dictionary<string, string> Messages = new(StringComparer.Ordinal)
    {
        ["invalid-credential"] = "Tên đăng nhập hoặc mật khẩu không chính xác.",
        ["local-rate-limited"] = "Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng chờ rồi thử lại.",
        ["account-locked"] = "Bạn đã đăng nhập sai nhiều lần. Vui lòng chờ hết thời gian khóa.",
        ["password-reset-required"] = "Tài khoản cần đặt lại mật khẩu. Chọn Quên mật khẩu và nhập PIN của bạn.",
        ["invalid-recovery"] = "Thông tin khôi phục không chính xác. Hãy kiểm tra tên đăng nhập, họ tên, số điện thoại và PIN (nếu có).",
        ["pin-reset-required"] = "Bạn đã nhập sai PIN 5 lần. Còn 0 lượt thử PIN cũ. Hãy trả lời đúng 3 câu hỏi và đặt PIN mới để tiếp tục.",
        ["pin-format-update-required"] = "PIN hiện tại dùng độ dài cũ. Hãy trả lời đúng 3 câu hỏi để đặt PIN mới gồm 4–6 chữ số.",
        ["invalid-answers"] = "Thông tin trả lời chưa chính xác. Cần trả lời đúng cả 3 câu hỏi.",
        ["invalid-security-proof"] = "Thông tin tài khoản, mật khẩu hoặc PIN cũ không chính xác.",
        ["session-required"] = "Vui lòng đăng nhập lại trước khi đổi PIN.",
        ["security-setup-required"] = "Tài khoản chưa thiết lập PIN và câu hỏi. Hãy đăng nhập và mở trang Tài khoản để thiết lập.",
        ["security-already-configured"] = "Tài khoản đã có PIN. Hãy dùng chức năng đổi PIN với PIN cũ.",
        ["answers-locked"] = "Bạn đã trả lời sai quá nhiều lần. Vui lòng thử lại sau.",
        ["invalid-recovery-code"] = "Tên đăng nhập hoặc mã khôi phục không chính xác.",
        ["recovery-locked"] = "Bạn đã nhập sai thông tin xác minh quá nhiều lần. Vui lòng thử lại sau."
    };
    public async Task HandleAsync(HttpContext context, string action)
    {
        context.Response.Headers.CacheControl = "no-store";
        var cookie = LocalSession.SessionCookie(context);
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        async Task SendResult(LocalAuthResult result)
        {
            if (result.RetryAfter is > 0) context.Response.Headers.RetryAfter = result.RetryAfter.ToString();
            if (result.Status == 401 && result.Code == "session-required") LocalSession.SetSessionCookie(context);
            context.Response.StatusCode = result.Status;
            var data = new Dictionary<string, object>();
            if (result.Status != 200)
            {
                if (result.Code is not null) data["code"] = result.Code;
                data["error"] = Messages.GetValueOrDefault(result.Code ?? "") ?? "Chưa xử lý được yêu cầu.";
                if (result.AttemptsRemaining is not null) data["attemptsRemaining"] = result.AttemptsRemaining;
                if (result.RetryAfter is > 0) data["retryAfter"] = result.RetryAfter;
            }
            else
            {
                if (result.SessionToken is { Length: > 0 }) LocalSession.SetSessionCookie(context, result.SessionToken);
                if (result.Account is not null) data["account"] = result.Account;
                if (result.Questions is not null) data["questions"] = result.Questions;
                if (result.PinResetRequired) { data["pinResetRequired"] = true; data["pinResetReason"] = result.PinResetReason!; }
            }
            await context.Response.WriteAsJsonAsync(data, context.RequestAborted);
        }
        if (!Actions.Contains(action)) { await Error(404, "not-found", "Không tìm thấy chức năng tài khoản."); return; }
        var method = action == "session" ? "GET" : "POST";
        if (context.Request.Method != method)
        { context.Response.Headers.Allow = method; await Error(405, "method-not-allowed", "Phương thức không được hỗ trợ."); return; }
        try
        {
            if (action is not "session" and not "logout")
            {
                var bucket = action == "register" ? "register" : action == "login" ? "login" : "recovery";
                var retry = _limit.Check($"{context.Connection.RemoteIpAddress?.ToString() ?? "local"}:{bucket}", bucket == "register" ? 5 : 60, bucket == "register" ? 600_000 : 900_000);
                if (retry != 0) { await SendResult(new(429, "local-rate-limited", retry)); return; }
            }
            if (action == "logout")
            { await accounts.LogoutAsync(LocalSession.SessionCookies(context)); LocalSession.SetSessionCookie(context); await context.Response.WriteAsJsonAsync(new { ok = true }, context.RequestAborted); return; }
            if (action == "session")
            {
                var account = await accounts.SessionAsync(cookie);
                if (account is null && cookie is not null) LocalSession.SetSessionCookie(context);
                if (account is null) await Error(401, "session-required", "Vui lòng đăng nhập lại.");
                else await context.Response.WriteAsJsonAsync(new { account }, context.RequestAborted);
                return;
            }
            var result = await accounts.ExecuteAsync(action, await JsonInput.ReadAsync(context), LocalSession.SessionCookies(context), cookie);
            if (action is "recover-pin" or "reset" && result.Status == 200) LocalSession.SetSessionCookie(context);
            await SendResult(result);
        }
        catch (LocalAccountException error) when (error.Status == 429)
        { context.Response.Headers.RetryAfter = "5"; context.Response.StatusCode = 429; await context.Response.WriteAsJsonAsync(new { code = error.Code, error = error.Message, retryAfter = 5 }, context.RequestAborted); }
        catch (LocalAccountException error) when (error.Status is 400 or 409) { await Error(error.Status, error.Code, error.Message); }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch { if (!context.Response.HasStarted) await Error(503, "local-auth-unavailable", "Chưa xử lý được tài khoản. Vui lòng thử lại."); }
    }
}
