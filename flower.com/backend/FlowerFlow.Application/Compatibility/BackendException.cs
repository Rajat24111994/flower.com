namespace FlowerFlow.Application.Compatibility;

public sealed class BackendException(string code, string message, int? retryAfter = null) : Exception(message)
{
    public string Code { get; } = code;
    public int? RetryAfter { get; } = retryAfter;
}
