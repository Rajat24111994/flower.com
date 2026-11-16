using FlowerFlow.Application.Orders;
using Grpc.Core;
using Xunit;

namespace FlowerFlow.Api.Tests;

public sealed class InventoryRetryTests
{
    [Theory]
    [InlineData(StatusCode.Unavailable)]
    [InlineData(StatusCode.DeadlineExceeded)]
    [InlineData(StatusCode.AlreadyExists)]
    [InlineData(StatusCode.PermissionDenied)]
    [InlineData(StatusCode.Cancelled)]
    public async Task Ambiguous_or_nonretryable_failures_never_repeat_the_work(StatusCode status)
    {
        var calls = 0;
        var error = await Assert.ThrowsAsync<RpcException>(() => InventoryTransactions.RunAsync<int>(() =>
        { calls++; throw new RpcException(new Status(status, "test-only")); }, CancellationToken.None));
        Assert.Equal(status, error.StatusCode); Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Aborted_reruns_reads_and_returns_the_new_result()
    {
        var calls = 0;
        var result = await InventoryTransactions.RunAsync(() =>
        {
            if (++calls == 1) throw new RpcException(new Status(StatusCode.Aborted, "retry"));
            return Task.FromResult("fresh-state");
        }, CancellationToken.None);
        Assert.Equal("fresh-state", result); Assert.Equal(2, calls);
    }

    [Fact]
    public async Task Exhausted_aborts_propagate_instead_of_retrying_forever()
    {
        var calls = 0;
        await Assert.ThrowsAsync<RpcException>(() => InventoryTransactions.RunAsync<int>(() =>
        { calls++; throw new RpcException(new Status(StatusCode.Aborted, "retry")); }, CancellationToken.None));
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task Readonly_replay_returns_once_and_pre_cancelled_work_does_not_start()
    {
        var calls = 0;
        Assert.Equal("saved", await InventoryTransactions.RunAsync(() =>
        { calls++; return Task.FromResult(InventoryTransactions.ReadOnly("saved")); }, CancellationToken.None));
        Assert.Equal(1, calls);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => InventoryTransactions.RunAsync(() =>
        { calls++; return Task.FromResult("unexpected"); }, cancelled.Token));
        Assert.Equal(1, calls);
    }
}
