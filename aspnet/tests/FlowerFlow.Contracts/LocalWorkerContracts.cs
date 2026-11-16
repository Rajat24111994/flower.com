using FlowerFlow.Infrastructure.Local;

static class LocalWorkerContracts
{
    public static async Task RunAsync()
    {
        using var started = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
        await using (var worker = new LocalAccountWorker(() => { started.Set(); release.Wait(); return new LocalAccounts(); }))
        {
            AdditionalContracts.Require(started.Wait(TimeSpan.FromSeconds(10)), "Worker did not start on a dedicated thread");
            var requests = Enumerable.Range(0, 16).Select(_ => worker.SessionAsync(null)).ToArray();
            try { await worker.SessionAsync(null); throw new Exception("Worker exceeded 16 pending requests"); }
            catch (LocalAccountException error) { AdditionalContracts.Require(error.Status == 429 && error.Code == "local-auth-busy", "Wrong queue overload error"); }
            release.Set();
            AdditionalContracts.Require((await Task.WhenAll(requests)).All(value => value is null), "Queued sessions failed after initialization");
            await worker.LogoutAsync([]);
        }
        var failed = new LocalAccountWorker(() => throw new Exception("secret initializer detail"));
        try { await failed.SessionAsync(null); throw new Exception("Failed worker accepted a request"); }
        catch (InvalidOperationException error) { AdditionalContracts.Require(error.Message == "Local account worker unavailable", "Worker initializer details leaked"); }
        await failed.DisposeAsync();
        try { await failed.SessionAsync(null); throw new Exception("Closed worker accepted a request"); } catch (InvalidOperationException) { }
        Console.WriteLine("PASS: dedicated local worker bounded queue, startup failure, graceful closure and generic unavailable errors.");
    }
}
