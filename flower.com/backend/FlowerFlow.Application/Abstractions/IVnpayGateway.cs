namespace FlowerFlow.Application.Abstractions;

/// <summary>VNPay merchant configuration; throws <see cref="VnpayException"/> when it is missing or invalid.</summary>
public interface IVnpayGateway
{
    VnpaySecrets GetSecrets();
    VnpayConfig GetConfig();
}
