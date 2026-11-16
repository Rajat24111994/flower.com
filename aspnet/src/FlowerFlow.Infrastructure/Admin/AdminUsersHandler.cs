using System.Text.Json;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Admin;

/// <summary>Port of backend/admin/users.js.</summary>
public sealed class AdminUsersHandler(IFirebaseAccounts accounts, Func<FirestoreDb> database, FirebaseAdminService authentication,
    AdminAuditHandler audit, ILogger<AdminUsersHandler> logger)
{
    public Task HandleAsync(HttpContext context) => new ApiRoutes(ListAsync, new Dictionary<string, RequestDelegate> { ["audit"] = audit.HandleAsync }).InvokeAsync(context);
    private async Task ListAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        if (context.Request.Method != "POST")
        { context.Response.Headers.Allow = "POST"; await Error(405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST."); return; }
        try { accounts.EnsureConfigured(); database(); }
        catch { await Error(503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình."); return; }
        if (await authentication.VerifyAdminRequestAsync(context) is null) return;
        var body = await JsonInput.ReadAsync(context); var token = Js.Truthy(body) ? Js.Get(body, "pageToken") : body;
        if (token.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null)
            && (!Js.IsString(token) || token.GetString()!.Length > 2048))
        { await Error(400, "invalid-argument", "Mã phân trang không hợp lệ."); return; }
        try
        {
            var page = await accounts.ListUsersAsync(Js.IsString(token) && token.GetString()!.Length > 0 ? token.GetString() : null, context.RequestAborted);
            await context.Response.WriteAsJsonAsync(new
            {
                users = page.Users.Select(user => new { uid = user.Uid, email = user.Email ?? "", displayName = user.DisplayName ?? "", providers = user.Providers,
                    creationTime = user.CreationTime, lastSignInTime = user.LastSignInTime, disabled = user.Disabled, role = user.Role }).ToList(),
                nextPageToken = string.IsNullOrEmpty(page.NextPageToken) ? null : page.NextPageToken
            }, context.RequestAborted);
        }
        catch { logger.LogError("Firebase user listing failed."); await Error(500, "user-list-failed", "Chưa thể tải danh sách tài khoản Firebase."); }
    }
}
