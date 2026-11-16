using FlowerFlow.Application.Orders;
using Grpc.Core;

static class InventoryTransactionContracts
{
    public static async Task RunAsync()
    {
        var attempts = 0;
        var result = await InventoryTransactions.RunAsync(() =>
        {
            if (++attempts == 1) throw new RpcException(new Status(StatusCode.Aborted, "retry"));
            return Task.FromResult(attempts);
        }, CancellationToken.None);
        AdditionalContracts.Require(result == 2 && attempts == 2, "Aborted must rerun the transaction callback");

        foreach (var status in new[] { StatusCode.Aborted, StatusCode.Unavailable, StatusCode.DeadlineExceeded,
            StatusCode.AlreadyExists, StatusCode.PermissionDenied, StatusCode.Cancelled })
        {
            attempts = 0;
            try
            {
                await InventoryTransactions.RunAsync<int>(() =>
                {
                    attempts++;
                    throw new RpcException(new Status(status, "test-only"));
                }, CancellationToken.None);
                throw new Exception("Transaction error was swallowed");
            }
            catch (RpcException error)
            {
                AdditionalContracts.Require(error.StatusCode == status && attempts == (status == StatusCode.Aborted ? 3 : 1),
                    "Retry policy exceeded its bounds or retried a non-Aborted failure");
            }
        }

        attempts = 0;
        var replay = await InventoryTransactions.RunAsync(() =>
        {
            attempts++;
            return Task.FromResult(InventoryTransactions.ReadOnly("saved-order"));
        }, CancellationToken.None);
        AdditionalContracts.Require(replay == "saved-order" && attempts == 1, "Read-only result must not rerun/commit");

        using var cancelled = new CancellationTokenSource();
        attempts = 0;
        try
        {
            await InventoryTransactions.RunAsync<int>(() =>
            {
                attempts++; cancelled.Cancel();
                throw new RpcException(new Status(StatusCode.Aborted, "cancel-backoff"));
            }, cancelled.Token);
            throw new Exception("Cancellation was ignored");
        }
        catch (OperationCanceledException)
        {
            AdditionalContracts.Require(attempts == 1, "Cancelled retry must not start another transaction");
        }
        Console.WriteLine("PASS: inventory retry bounds, Aborted-only retries, read-only completion and cancellation.");
    }
}
