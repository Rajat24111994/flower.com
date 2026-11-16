using FlowerFlow.Application.Commerce;
using FlowerFlow.Domain.Commerce;
using System.Text.Json;

namespace FlowerFlow.InMemory;

/// <summary>One singleton per application. A working copy is published only after successful completion.
/// The gate protects multi-repository operations, not just individual dictionary writes.</summary>
public sealed class InMemoryUnitOfWork : ICommerceUnitOfWork, IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<Type, Dictionary<string, IEntity>> _committed = new();

    public InMemoryUnitOfWork()
    {
        Seed(new Category("birthday", "Hoa sinh nhật"));
        Seed(new Category("love", "Hoa tình yêu"));
        Seed(new DeliveryZone("hcm-q1", "Hồ Chí Minh", "Quận 1", 30000));
        Seed(new WrappingSettings("default", [new WrappingTier(10, 20000), new WrappingTier(30, 40000), new WrappingTier(50, 60000)]));
        Seed(new Promotion("demo10", "Ưu đãi giả lập 10%", 10, true, [], true));
        Seed(new Product("bouquet-rose", "Bó hồng", "Bó hoa hồng làm sẵn", "/images/rose.webp", [], "love", 450000, 20,
            "ready_made", "active", "Tình yêu", ["Hồng"], ["Sinh nhật"]));
        Seed(new Product("stem-rose", "Cành hồng", "Hoa hồng bán theo cành", "/images/rose.webp", [], "love", 25000, 100,
            "flower", "active", "", ["Đỏ"], []));
        foreach (var user in new[] { new ShopUser("owner", "owner"), new ShopUser("admin", "admin"),
            new ShopUser("customer-a", "customer"), new ShopUser("customer-b", "customer") }) Seed(user);
    }

    private void Seed<T>(T entity) where T : class, IEntity
    {
        if (!_committed.TryGetValue(typeof(T), out var table)) _committed[typeof(T)] = table = new(StringComparer.Ordinal);
        table.Add(entity.Id, entity);
    }

    public async Task<T> ExecuteAsync<T>(Func<ICommerceSession, CancellationToken, Task<T>> operation, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var working = _committed.ToDictionary(pair => pair.Key, pair => new Dictionary<string, IEntity>(pair.Value, StringComparer.Ordinal));
            var session = new Session(working);
            try
            {
                var result = await operation(session, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                _committed = working;
                return result;
            }
            finally { session.Close(); }
        }
        finally { _gate.Release(); }
    }

    public void Dispose() => _gate.Dispose();

    private sealed class Session(Dictionary<Type, Dictionary<string, IEntity>> tables) : ICommerceSession
    {
        private bool _active = true;
        public void Close() => _active = false;
        public void EnsureActive(CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            if (!_active) throw new InvalidOperationException("Repository session has ended.");
        }
        public IRepository<T> Repository<T>() where T : class, IEntity
        {
            EnsureActive(default);
            if (!tables.TryGetValue(typeof(T), out var table)) tables[typeof(T)] = table = new(StringComparer.Ordinal);
            return new Repository<T>(this, table);
        }
    }

    private sealed class Repository<T>(Session session, Dictionary<string, IEntity> table) : IRepository<T> where T : class, IEntity
    {
        // Keep caller-owned collections out of committed state, and never hand stored arrays
        // back to callers. A shallow record copy alone would not isolate list mutations.
        private static T Copy(T entity) => JsonSerializer.Deserialize<T>(JsonSerializer.SerializeToUtf8Bytes(entity))!;
        public Task<T?> FindAsync(string id, CancellationToken ct)
        { session.EnsureActive(ct); return Task.FromResult(table.GetValueOrDefault(id) is T item ? Copy(item) : null); }
        public Task<IReadOnlyList<T>> ListAsync(CancellationToken ct)
        { session.EnsureActive(ct); return Task.FromResult<IReadOnlyList<T>>(table.Values.Cast<T>().Select(Copy).ToArray()); }
        public Task PutAsync(T entity, CancellationToken ct)
        { session.EnsureActive(ct); table[entity.Id] = Copy(entity); return Task.CompletedTask; }
        public Task RemoveAsync(string id, CancellationToken ct)
        { session.EnsureActive(ct); table.Remove(id); return Task.CompletedTask; }
    }
}
