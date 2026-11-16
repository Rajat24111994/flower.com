using System.ComponentModel.DataAnnotations;
using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Application.Commerce;

public sealed record UserRoleRequest([Required, RegularExpression("^(admin|customer)$")] string Role);

public sealed class AdminService(ICommerceUnitOfWork work, ICurrentActor actor, TimeProvider time)
{
    public Task<IReadOnlyList<ShopUser>> UsersAsync(CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        return work.ExecuteAsync((session, token) => session.Repository<ShopUser>().ListAsync(token), ct);
    }
    public Task<ShopUser> RoleAsync(string id, UserRoleRequest request, CancellationToken ct = default)
    {
        CommerceAccess.Owner(actor); InputValidation.Validate(request);
        if (id == actor.UserId) throw new CommerceException(400, "invalid-argument", "Owner không thể tự thay đổi quyền của mình.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var repository = session.Repository<ShopUser>(); var user = await repository.FindAsync(id, token) ?? throw CommerceException.Missing("tài khoản");
            if (user.Role == "owner") throw new CommerceException(403, "permission-denied", "Không thể đổi quyền Owner qua API này.");
            if (request.Role == "customer" && user.Role != "admin") throw new CommerceException(400, "invalid-argument", "Tài khoản hiện không có quyền quản trị.");
            var updated = user with { Role = request.Role }; await repository.PutAsync(updated, token);
            await session.Repository<AuditEntry>().PutAsync(new(Guid.NewGuid().ToString("N"), actor.UserId,
                request.Role == "admin" ? "owner.grant-admin" : "owner.remove-admin", id, time.GetUtcNow()), token);
            return updated;
        }, ct);
    }
    public Task<Page<AuditEntry>> AuditAsync(int page = 1, int pageSize = 25, CancellationToken ct = default)
    {
        CommerceAccess.Admin(actor);
        if (page < 1 || pageSize is < 1 or > 100) throw new CommerceException(400, "invalid-argument", "Phân trang không hợp lệ.");
        return work.ExecuteAsync(async (session, token) =>
        {
            var all = (await session.Repository<AuditEntry>().ListAsync(token)).OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id).ToArray();
            return new Page<AuditEntry>(all.Skip((int)Math.Min((long)(page - 1) * pageSize, int.MaxValue)).Take(pageSize).ToArray(), all.Length, page, pageSize);
        }, ct);
    }
}
