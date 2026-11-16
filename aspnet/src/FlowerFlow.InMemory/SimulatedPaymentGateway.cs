using FlowerFlow.Application.Commerce;

namespace FlowerFlow.InMemory;

public sealed class SimulatedPaymentGateway : IPaymentGateway
{
    public Task<GatewaySession> CreateAsync(string paymentId, long amount, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new GatewaySession("simulated-" + paymentId, "Simulated"));
    }
}
