using System.Text.Json;
using FirebaseAdmin.Auth;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Admin;

/// <summary>Port of backend/admin/owner-users.js, including partial-success errors after an irreversible Auth change.</summary>
public sealed class OwnerUsersHandler(IFirebaseAccounts accounts, Func<FirestoreDb> database, FirebaseAdminService authentication,
    ILogger<OwnerUsersHandler> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        if (context.Request.Method != "POST")
        { context.Response.Headers.Allow = "POST"; await Error(405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST."); return; }
        FirestoreDb db;
        try { accounts.EnsureConfigured(); db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình."); return; }
        var owner = await authentication.VerifyOwnerRequestAsync(context); if (owner is null) return;
        var body = await JsonInput.ReadAsync(context); var rawAction = Js.Get(body, "action"); var action = Js.IsString(rawAction) ? rawAction.GetString()! : "";
        if (action == "list")
        {
            var token = Js.Get(body, "pageToken");
            if (token.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null) && (!Js.IsString(token) || token.GetString()!.Length > 2048))
            { await Error(400, "invalid-argument", "Mã phân trang không hợp lệ."); return; }
            try
            {
                var page = await accounts.ListUsersAsync(Js.IsString(token) && token.GetString()!.Length > 0 ? token.GetString() : null, context.RequestAborted);
                if (page.Users.Count > 0)
                {
                    try { await AdminRoles.SyncAdminRolesAsync(db, page.Users.Select(user => user.ToRoleUser()).ToList()); }
                    catch { logger.LogError("Admin role backfill failed."); }
                }
                await context.Response.WriteAsJsonAsync(new { users = page.Users.Select(user => new { uid = user.Uid, email = user.Email ?? "",
                    displayName = user.DisplayName ?? "", disabled = user.Disabled, role = user.Role }).ToList(),
                    nextPageToken = string.IsNullOrEmpty(page.NextPageToken) ? null : page.NextPageToken }, context.RequestAborted);
            }
            catch { logger.LogError("Owner user listing failed."); await Error(500, "user-list-failed", "Chưa thể tải danh sách tài khoản Firebase."); }
            return;
        }
        if (action is not ("grant-admin" or "remove-admin"))
        { await Error(400, "invalid-argument", "Thao tác quản lý chủ cửa hàng không được hỗ trợ."); return; }
        var uid = Js.Get(body, "uid");
        if (!Js.IsString(uid) || uid.GetString()!.Trim().Length == 0 || uid.GetString()!.Length > 128)
        { await Error(400, "invalid-argument", "Cần mã UID tài khoản hợp lệ."); return; }
        if (uid.GetString() == owner.Uid) { await Error(400, "invalid-argument", "Chủ cửa hàng không thể tự thay đổi quyền của mình."); return; }
        // Once changing claims, complete role mirroring/revocation even if the client disconnects.
        var policyCancellation = CancellationToken.None;
        try
        {
            var user = await accounts.GetUserAsync(uid.GetString()!, policyCancellation);
            if (user.Role == "owner") { await Error(403, "permission-denied", "Không thể thay đổi quyền của tài khoản chủ cửa hàng tại đây."); return; }
            var claims = new Dictionary<string, object>(user.CustomClaims); var grant = action == "grant-admin";
            if (grant) { claims["admin"] = true; claims["role"] = "admin"; }
            else
            {
                if (user.Role != "admin") { await Error(400, "invalid-argument", "Tài khoản này hiện không có quyền quản trị viên."); return; }
                claims.Remove("admin"); claims.Remove("role");
            }
            await accounts.SetCustomClaimsAsync(user.Uid, claims, policyCancellation);
            await AdminRoles.SyncAdminRoleAsync(db, user.ToRoleUser(), grant, policyCancellation);
            try { await accounts.RevokeRefreshTokensAsync(user.Uid, policyCancellation); }
            catch
            {
                logger.LogError("Role changed but session revocation failed.");
                await Error(500, "role-updated-session-revoke-failed", "Đã đổi quyền nhưng chưa thể thu hồi phiên đăng nhập cũ. Hãy thu hồi phiên này trong Firebase Console."); return;
            }
            try
            {
                await AdminAudit.RecordAdminAuditAsync(db, owner, "owner-user." + action, "user-role", user.Uid,
                    new Dictionary<string, object> { ["previousRole"] = user.Role, ["nextRole"] = grant ? "admin" : "customer" }, policyCancellation);
            }
            catch
            {
                logger.LogError("Owner role changed but audit record failed.");
                await Error(500, "role-updated-audit-failed", "Đã đổi quyền và thu hồi phiên đăng nhập, nhưng chưa ghi được nhật ký kiểm tra."); return;
            }
            logger.LogInformation("Owner changed account role ({Action}).", action);
            await context.Response.WriteAsJsonAsync(new { uid = user.Uid, role = grant ? "admin" : "customer", message = "Role updated. The account must sign in again." }, context.RequestAborted);
        }
        catch (Exception error)
        {
            logger.LogError("Owner role update failed.");
            if (error is FirebaseAccountException { Code: "auth/user-not-found" }
                || error is FirebaseAuthException { AuthErrorCode: AuthErrorCode.UserNotFound })
            { await Error(404, "user-not-found", "Không tìm thấy tài khoản Firebase."); return; }
            await Error(500, "role-update-failed", "Chưa thể cập nhật quyền tài khoản.");
        }
    }
}
