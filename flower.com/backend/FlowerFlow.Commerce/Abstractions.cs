using FlowerFlow.Domain.Commerce;

namespace FlowerFlow.Commerce;

public interface IRepository<T> where T : class, IEntity
{
    Task<T?> FindAsync(string id, CancellationToken cancellationToken);
    Task<IReadOnlyList<T>> ListAsync(CancellationToken cancellationToken);
    Task PutAsync(T entity, CancellationToken cancellationToken);
    Task RemoveAsync(string id, CancellationToken cancellationToken);
}

public interface ICommerceSession
{
    IRepository<T> Repository<T>() where T : class, IEntity;
}

/// <summary>Commits all changes or rolls back all of them, with serializable isolation.
/// A future SQL implementation must preserve this contract, including concurrency tests.</summary>
public interface ICommerceUnitOfWork
{
    Task<T> ExecuteAsync<T>(Func<ICommerceSession, CancellationToken, Task<T>> operation,
        CancellationToken cancellationToken = default);
}

public interface ICurrentActor
{
    string UserId { get; }
    string Role { get; }
    string ClientKey => "local";
}

public sealed class CommerceException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public int? RetryAfter { get; init; }
    public static CommerceException Missing(string resource) => new(404, "not-found", $"Không tìm thấy {resource}.");
    public static CommerceException Conflict(string code, string message) => new(409, code, message);
}

public static class CommerceAccess
{
    public static void Admin(ICurrentActor actor)
    {
        if (actor.Role is not ("admin" or "owner")) throw new CommerceException(403, "forbidden", "Cần quyền quản trị viên.");
    }
    public static void Owner(ICurrentActor actor)
    {
        if (actor.Role != "owner") throw new CommerceException(403, "forbidden", "Cần quyền Owner.");
    }
    public static void Customer(ICurrentActor actor)
    {
        if (string.IsNullOrEmpty(actor.UserId)) throw new CommerceException(401, "unauthenticated", "Cần đăng nhập.");
    }
    public static void OwnOrAdmin(ICurrentActor actor, string userId)
    {
        Customer(actor);
        if (actor.UserId != userId && actor.Role is not ("admin" or "owner"))
            throw new CommerceException(404, "not-found", "Không tìm thấy tài nguyên.");
    }
}
