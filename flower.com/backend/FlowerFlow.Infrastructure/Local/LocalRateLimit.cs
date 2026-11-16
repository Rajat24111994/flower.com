namespace FlowerFlow.Infrastructure.Local;

// Port of lib/local-rate-limit.js. One lock preserves Node's synchronous Map updates.
public sealed class LocalRateLimit(Func<long>? now = null, int capacity = 5000)
{
    private readonly Func<long> _now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private sealed class Entry(long until) { public long Until { get; } = until; public int Attempts { get; set; } }
    public int Check(string key, int maximum, long duration)
    {
        lock (_gate)
        {
            var time = _now();
            foreach (var expired in _entries.Where(pair => pair.Value.Until <= time).Select(pair => pair.Key).ToArray()) _entries.Remove(expired);
            if (!_entries.TryGetValue(key, out var entry))
            {
                if (_entries.Count >= capacity) return 60;
                _entries[key] = entry = new Entry(time + duration);
            }
            if (entry.Attempts >= maximum) return Math.Max(1, (int)Math.Ceiling((entry.Until - time) / 1000d));
            entry.Attempts++; return 0;
        }
    }
}
