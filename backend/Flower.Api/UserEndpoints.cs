using System.Globalization;
using System.Text.Json;
using FirebaseAdmin.Auth;
using Google.Cloud.Firestore;

namespace Flower.Api;

public sealed class UserEndpoints(FirebaseServices firebase, ILogger<UserEndpoints> logger)
{
    public static bool IsAdmin(IReadOnlyDictionary<string, object> claims) => claims.TryGetValue("admin", out var value) && value is true;
    public static string Role(IReadOnlyDictionary<string, object> claims) =>
        claims.TryGetValue("role", out var role) && role is "owner" ? "owner" : IsAdmin(claims) ? "admin" : "customer";

    public async Task Handle(HttpContext context, bool owner)
    {
        if (context.Request.Method != "POST")
        {
            context.Response.Headers.Allow = "POST";
            throw new ApiException(405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST.");
        }
        var actor = await firebase.Verify(context);
        if (owner ? !actor.Claims.TryGetValue("role", out var role) || role is not "owner" : !IsAdmin(actor.Claims))
            throw new ApiException(403, "permission-denied", owner
                ? "Chỉ chủ cửa hàng mới được quản lý quyền tài khoản."
                : "Bạn cần quyền quản trị viên để xem danh sách tài khoản.");

        JsonElement body;
        try
        {
            using var document = context.Request.ContentLength == 0 || context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature>()?.CanHaveBody == false
                ? JsonDocument.Parse("{}")
                : await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            body = document.RootElement.Clone();
            if (body.ValueKind != JsonValueKind.Object) throw new JsonException();
        }
        catch (JsonException) { throw new ApiException(400, "invalid-argument", "Nội dung yêu cầu không hợp lệ."); }
        if (!owner || String(body, "action") == "list")
        {
            var pageToken = PageToken(body);
            try
            {
                // Read exactly one Firebase page; enumerating the complete async stream changes
                // the existing pagination contract and can backfill unrelated accounts.
                var page = await firebase.Auth.ListUsersAsync(new ListUsersOptions { PageSize = 100, PageToken = pageToken })
                    .ReadPageAsync(100, context.RequestAborted);
                var users = page.ToArray();
                if (owner && users.Length > 0)
                {
                    try { await Backfill(users); }
                    catch (Exception error) { logger.LogWarning("adminRoles backfill failed ({ExceptionType})", error.GetType().Name); }
                }
                var result = users.Select(user => SerializeUser(user, owner)).ToArray();
                await context.Response.WriteAsJsonAsync(new { users = result, nextPageToken = string.IsNullOrEmpty(page.NextPageToken) ? null : page.NextPageToken }, context.RequestAborted);
            }
            catch (Exception error) when (error is not ApiException)
            {
                throw new ApiException(500, "user-list-failed", "Chưa thể tải danh sách tài khoản Firebase.");
            }
            return;
        }

        var action = String(body, "action");
        if (action is not ("grant-admin" or "remove-admin"))
            throw new ApiException(400, "invalid-argument", "Thao tác quản lý chủ cửa hàng không được hỗ trợ.");
        var uid = String(body, "uid");
        if (string.IsNullOrWhiteSpace(uid) || uid.Length > 128)
            throw new ApiException(400, "invalid-argument", "Cần mã UID tài khoản hợp lệ.");
        if (uid == actor.Uid)
            throw new ApiException(400, "invalid-argument", "Chủ cửa hàng không thể tự thay đổi quyền của mình.");
        try
        {
            var user = await firebase.Auth.GetUserAsync(uid, context.RequestAborted);
            if (Role(user.CustomClaims) == "owner")
                throw new ApiException(403, "permission-denied", "Không thể thay đổi quyền của tài khoản chủ cửa hàng tại đây.");
            var claims = new Dictionary<string, object>(user.CustomClaims);
            var grant = action == "grant-admin";
            if (grant) { claims["admin"] = true; claims["role"] = "admin"; }
            else
            {
                if (Role(user.CustomClaims) != "admin")
                    throw new ApiException(400, "invalid-argument", "Tài khoản này hiện không có quyền quản trị viên.");
                claims.Remove("admin");
                claims.Remove("role");
            }
            await firebase.Auth.SetCustomUserClaimsAsync(uid, claims, context.RequestAborted);
            var reference = firebase.Db.Collection("adminRoles").Document(uid);
            if (grant)
                await reference.SetAsync(Mirror(user), SetOptions.MergeAll, context.RequestAborted);
            else
                await reference.DeleteAsync(cancellationToken: context.RequestAborted);
            try { await firebase.Auth.RevokeRefreshTokensAsync(uid, context.RequestAborted); }
            catch
            {
                throw new ApiException(500, "role-updated-session-revoke-failed",
                    "Đã đổi quyền nhưng chưa thể thu hồi phiên đăng nhập cũ. Hãy thu hồi phiên này trong Firebase Console.");
            }
            logger.LogInformation("Owner {ActorUid} changed account {TargetUid}: {Action}", actor.Uid, uid, action);
            await context.Response.WriteAsJsonAsync(new { uid, role = grant ? "admin" : "customer", message = "Role updated. The account must sign in again." });
        }
        catch (FirebaseAuthException error) when (error.AuthErrorCode == AuthErrorCode.UserNotFound)
        {
            throw new ApiException(404, "user-not-found", "Không tìm thấy tài khoản Firebase.");
        }
        catch (Exception error) when (error is not ApiException)
        {
            throw new ApiException(500, "role-update-failed", "Chưa thể cập nhật quyền tài khoản.");
        }
    }

    private async Task Backfill(UserRecord[] users)
    {
        var db = firebase.Db;
        var references = users.Select(user => db.Collection("adminRoles").Document(user.Uid)).ToArray();
        var snapshots = await db.GetAllSnapshotsAsync(references);
        var batch = db.StartBatch();
        var writes = 0;
        for (var index = 0; index < users.Length; index++)
        {
            var admin = IsAdmin(users[index].CustomClaims);
            if (admin && !snapshots[index].Exists) { batch.Set(references[index], Mirror(users[index])); writes++; }
            else if (!admin && snapshots[index].Exists) { batch.Delete(references[index]); writes++; }
        }
        if (writes > 0) await batch.CommitAsync();
    }

    private static Dictionary<string, object> Mirror(UserRecord user) => new()
    {
        ["email"] = user.Email ?? "",
        ["role"] = Role(user.CustomClaims) == "owner" ? "owner" : "admin",
        ["updatedAt"] = FieldValue.ServerTimestamp
    };

    private static Dictionary<string, object?> SerializeUser(UserRecord user, bool owner)
    {
        var result = new Dictionary<string, object?>
        {
            ["uid"] = user.Uid, ["email"] = user.Email ?? "", ["displayName"] = user.DisplayName ?? "",
            ["disabled"] = user.Disabled, ["role"] = Role(user.CustomClaims)
        };
        if (!owner)
        {
            result["providers"] = user.ProviderData.Select(provider => provider.ProviderId).ToArray();
            result["creationTime"] = NodeDate(user.UserMetaData.CreationTimestamp);
            result["lastSignInTime"] = NodeDate(user.UserMetaData.LastSignInTimestamp);
        }
        return result;
    }

    private static string NodeDate(DateTime? date) => date?.ToUniversalTime().ToString("ddd, dd MMM yyyy HH:mm:ss 'GMT'", CultureInfo.InvariantCulture) ?? "";
    private static string String(JsonElement body, string key) => body.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : "";
    private static string? PageToken(JsonElement body)
    {
        if (!body.TryGetProperty("pageToken", out var token) || token.ValueKind == JsonValueKind.Null) return null;
        if (token.ValueKind != JsonValueKind.String || token.GetString()!.Length > 2048)
            throw new ApiException(400, "invalid-argument", "Mã phân trang không hợp lệ.");
        return token.GetString() is { Length: > 0 } value ? value : null;
    }
}
