using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Application.Accounts;

/// <summary>Account-wide Firebase revocation; never accepts a client-selected UID or local cookie identity.</summary>
public sealed class LogoutService(IFirebaseAuthService authentication, IFirebaseAccounts accounts,
    ILogger<LogoutService> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        Task Error(int status, string code, string message) => ApiResponse.SendErrorAsync(context, status, code, message);
        if (context.Request.Method != "POST")
        {
            context.Response.Headers.Allow = "POST";
            await Error(405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST.");
            return;
        }

        // Verify Firebase even in Development/local mode. A local session is not a Firebase account.
        var caller = await authentication.VerifyRequestAsync(context);
        if (caller is null) return;
        JsonElement body;
        try { body = await JsonInput.ReadAsync(context); }
        catch (JsonException)
        { await Error(400, "invalid-json", "Dữ liệu JSON không hợp lệ."); return; }
        if (context.Request.Query.Count != 0 || (body.ValueKind != JsonValueKind.Undefined
            && (body.ValueKind != JsonValueKind.Object || body.EnumerateObject().Any())))
        {
            await Error(400, "invalid-argument", "Không gửi UID hoặc tham số khác khi đăng xuất mọi thiết bị.");
            return;
        }

        try
        {
            // Complete the security action even if the initiating browser disconnects.
            await accounts.RevokeRefreshTokensAsync(caller.Uid, CancellationToken.None);
        }
        catch
        {
            logger.LogError("Firebase session revocation failed.");
            await Error(503, "logout-all-failed", "Chưa thể thu hồi các phiên Firebase. Vui lòng thử lại.");
            return;
        }
        await context.Response.WriteAsJsonAsync(new { ok = true, scope = "all" }, context.RequestAborted);
    }
}
