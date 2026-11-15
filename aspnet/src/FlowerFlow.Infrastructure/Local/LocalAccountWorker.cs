using System.Collections.Concurrent;
using System.Text.Json;

namespace FlowerFlow.Infrastructure.Local;

public interface ILocalAccountWorker
{
    Task<LocalAuthResult> ExecuteAsync(string action, JsonElement body, IEnumerable<string>? previous = null, string? token = null);
    Task<Dictionary<string, object>?> SessionAsync(string? token);
    Task LogoutAsync(IEnumerable<string> tokens);
}

// One dedicated thread owns synchronous SQLite and scrypt, matching the Node worker.
// The capacity includes the active request; disconnects do not discard authentication attempts.
public sealed class LocalAccountWorker : ILocalAccountWorker, IDisposable, IAsyncDisposable
{
    private sealed record Work(long Id, Func<LocalAccounts, object?> Run, TaskCompletionSource<object?> Completion);
    private readonly BlockingCollection<Work> _queue = new();
    private readonly Dictionary<long, TaskCompletionSource<object?>> _pending = [];
    private readonly object _gate = new();
    private readonly Thread _thread;
    private long _nextId;
    private bool _stopped;
    public LocalAccountWorker(string filename) : this(() => new LocalAccounts(filename)) { }
    public LocalAccountWorker(Func<LocalAccounts> factory)
    {
        _thread = new Thread(() => Run(factory)) { IsBackground = true, Name = "FlowerFlow local accounts" };
        _thread.Start();
    }
    private static Exception Unavailable() => new InvalidOperationException("Local account worker unavailable");
    private Task<object?> Call(Func<LocalAccounts, object?> action)
    {
        lock (_gate)
        {
            if (_stopped) return Task.FromException<object?>(Unavailable());
            if (_pending.Count >= 16) return Task.FromException<object?>(new LocalAccountException("local-auth-busy", "Máy chủ bận. Vui lòng thử lại sau.", 429));
            var completion = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
            var id = ++_nextId; _pending.Add(id, completion); _queue.Add(new(id, action, completion)); return completion.Task;
        }
    }
    private void Run(Func<LocalAccounts> factory)
    {
        try
        {
            using var accounts = factory();
            foreach (var work in _queue.GetConsumingEnumerable())
            {
                lock (_gate) if (_stopped) break;
                object? result = null; Exception? error = null;
                try { result = work.Run(accounts); } catch (Exception failure) { error = failure; }
                lock (_gate)
                {
                    if (!_pending.Remove(work.Id)) continue;
                    if (error is null) work.Completion.TrySetResult(result); else work.Completion.TrySetException(error);
                }
            }
        }
        catch { Stop(); }
        finally { Stop(); }
    }
    public async Task<LocalAuthResult> ExecuteAsync(string action, JsonElement body, IEnumerable<string>? previous = null, string? token = null)
    {
        var input = body.ValueKind == JsonValueKind.Undefined ? default : body.Clone(); var tokens = previous?.ToArray();
        return (LocalAuthResult)(await Call(accounts => action switch
        {
            "register" => accounts.Register(input, tokens), "login" => accounts.Login(input, tokens), "reset" => accounts.Reset(input, tokens),
            "questions" => accounts.Questions(input), "recover-pin" => accounts.RecoverPin(input, tokens),
            "change-pin" => accounts.ChangePin(input, token), "setup-security" => accounts.SetupSecurity(input, token),
            _ => throw new InvalidOperationException("Unknown local account method")
        }))!;
    }
    public async Task<Dictionary<string, object>?> SessionAsync(string? token) => (Dictionary<string, object>?)await Call(accounts => accounts.Session(token));
    public Task LogoutAsync(IEnumerable<string> tokens)
    { var snapshot = tokens.ToArray(); return Call(accounts => { accounts.Logout(snapshot); return null; }); }
    private void Stop()
    {
        lock (_gate)
        {
            if (_stopped) return; _stopped = true;
            foreach (var completion in _pending.Values) completion.TrySetException(Unavailable());
            _pending.Clear(); _queue.CompleteAdding();
        }
    }
    public void Dispose() { Stop(); if (Thread.CurrentThread != _thread) _thread.Join(); }
    public async ValueTask DisposeAsync() { Stop(); await Task.Run(_thread.Join); }
}
