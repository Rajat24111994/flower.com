using System.Globalization;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Firebase;

/// <summary>Preserves the legacy helpers' error body, status and live-role checks.</summary>
public sealed class FirebaseAuthService(IFirebaseAdminService backend, ILogger<FirebaseAuthService> logger) : IFirebaseAuthService
{
    public async Task<FirebaseIdentity?> VerifyRequestAsync(HttpContext context)
    {
        var token = BearerToken.Read(context.Request.Headers.Authorization.ToString(), singleToken: false);
        if (token is null)
        {
            await ApiResponse.SendErrorAsync(context, 401, "unauthenticated", "Cần mã xác thực Firebase để thực hiện thao tác này.");
            return null;
        }

        try
        {
            return await backend.VerifyIdTokenAsync(token, true, context.RequestAborted);
        }
        catch
        {
            // Never log provider errors, bearer tokens or credentials.
            logger.LogError("Firebase ID token verification failed.");
            await ApiResponse.SendErrorAsync(context, 401, "unauthenticated", "Mã xác thực Firebase không hợp lệ, đã hết hạn hoặc đã bị thu hồi.");
            return null;
        }
    }

    public Task<FirebaseIdentity?> VerifyAdminRequestAsync(HttpContext context) => VerifyRoleRequestAsync(context, false);
    public Task<FirebaseIdentity?> VerifyOwnerRequestAsync(HttpContext context) => VerifyRoleRequestAsync(context, true);

    private async Task<FirebaseIdentity?> VerifyRoleRequestAsync(HttpContext context, bool requireOwner)
    {
        var user = await VerifyRequestAsync(context);
        if (user is null) return null;
        if (!user.Claims.TryGetValue("admin", out var admin) || admin is not true)
        {
            await ApiResponse.SendErrorAsync(context, 403, "permission-denied", "Bạn cần quyền quản trị viên để thực hiện thao tác này.");
            return null;
        }

        AdminRole? role;
        try
        {
            role = await backend.GetAdminRoleAsync(user.Uid, context.RequestAborted);
        }
        catch
        {
            logger.LogError("Firebase admin role verification failed.");
            await ApiResponse.SendErrorAsync(context, 503, "authorization-service-unavailable", "Chưa thể xác minh quyền quản trị.");
            return null;
        }

        if (role is null || (requireOwner &&
            (!user.Claims.TryGetValue("role", out var claimRole) || claimRole is not "owner" || role.Role != "owner")))
        {
            await ApiResponse.SendErrorAsync(context, 403, "permission-denied", "Quyền quản trị viên đã bị thu hồi.");
            return null;
        }
        return user;
    }
}

/// <summary>Narrow SDK boundary for account operations; credentials never leave the server.</summary>
public sealed class FirebaseAccounts(FirebaseAdminService backend) : IFirebaseAccounts
{
    public string ProjectId => backend.ProjectId;
    public void EnsureConfigured() => backend.GetAdminAuth();
    public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken) => backend.GetAccessTokenAsync(cancellationToken);
    public Task<string> CreateCustomTokenAsync(string uid, CancellationToken cancellationToken) => backend.GetAdminAuth().CreateCustomTokenAsync(uid, cancellationToken);
    public async Task<FirebaseUserPage> ListUsersAsync(string? pageToken, CancellationToken cancellationToken)
    {
        var pages = backend.GetAdminAuth().ListUsersAsync(new ListUsersOptions { PageSize = 100, PageToken = pageToken }).AsRawResponses();
        await using var iterator = pages.GetAsyncEnumerator(cancellationToken);
        if (!await iterator.MoveNextAsync()) return new([], null);
        return new(iterator.Current.Users.Select(Map).ToList(), iterator.Current.NextPageToken);
    }
    public async Task<FirebaseAccount> GetUserAsync(string uid, CancellationToken cancellationToken)
    {
        try { return Map(await backend.GetAdminAuth().GetUserAsync(uid, cancellationToken)); }
        catch (FirebaseAuthException error) when (error.AuthErrorCode == AuthErrorCode.UserNotFound)
        { throw new FirebaseAccountException("auth/user-not-found"); }
    }
    public async Task SetCustomClaimsAsync(string uid, IDictionary<string, object> claims, CancellationToken cancellationToken)
    {
        try { await backend.GetAdminAuth().SetCustomUserClaimsAsync(uid, new Dictionary<string, object>(claims), cancellationToken); }
        catch (FirebaseAuthException error) when (error.AuthErrorCode == AuthErrorCode.UserNotFound)
        { throw new FirebaseAccountException("auth/user-not-found"); }
    }
    public Task RevokeRefreshTokensAsync(string uid, CancellationToken cancellationToken) => backend.GetAdminAuth().RevokeRefreshTokensAsync(uid, cancellationToken);
    public static RoleUser ToRoleUser(UserRecord user) => new(user.Uid, user.Email, user.CustomClaims);
    private static FirebaseAccount Map(UserRecord user) => new(user.Uid, user.Email, user.DisplayName, user.Disabled,
        user.CustomClaims, user.ProviderData.Select(provider => provider.ProviderId).ToList(),
        user.UserMetaData.CreationTimestamp?.ToUniversalTime().ToString("r", CultureInfo.InvariantCulture) ?? "",
        user.UserMetaData.LastSignInTimestamp?.ToUniversalTime().ToString("r", CultureInfo.InvariantCulture) ?? "");
}
