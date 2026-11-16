using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Application.Abstractions;

public sealed class RequestIdentityException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Resolves the optional signed-in customer for public APIs (Firebase ID token or trusted local session).</summary>
public interface IRequestIdentityService
{
    Task<FirebaseIdentity?> OptionalCustomerAsync(HttpContext context);
}
