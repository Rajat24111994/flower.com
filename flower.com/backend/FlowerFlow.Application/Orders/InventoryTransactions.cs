using Grpc.Core;

namespace FlowerFlow.Application.Orders;

/// <summary>Bounded retries only when Firestore guarantees that the transaction aborted.</summary>
public static class InventoryTransactions
{
    private sealed class ReadOnlyResult<T>(T result) : Exception
    {
        public T Result { get; } = result;
    }

    // Throw before staging any write. The SDK rolls back when its callback throws,
    // releasing read locks without an empty commit on a replay/no-op.
    public static T ReadOnly<T>(T result) => throw new ReadOnlyResult<T>(result);

    public static async Task<T> RunAsync<T>(Func<Task<T>> transaction, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { return await transaction(); }
            catch (ReadOnlyResult<T> completed) { return completed.Result; }
            catch (RpcException error) when (error.StatusCode == StatusCode.Aborted && attempt < 2)
            {
                // Re-run the entire SDK transaction, including reads and validation.
                // Never retry an ambiguous commit (e.g. Unavailable or DeadlineExceeded).
                await Task.Delay(100 * (1 << attempt) + Random.Shared.Next(100), cancellationToken);
            }
        }
    }
}
