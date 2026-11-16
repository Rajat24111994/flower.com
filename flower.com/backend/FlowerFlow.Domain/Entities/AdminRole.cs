namespace FlowerFlow.Domain.Entities;

/// <summary>Document in <c>adminRoles/{uid}</c>; its existence grants admin access, <c>role</c> distinguishes the Owner.</summary>
public sealed record AdminRole(string? Role)
{
    public const string Collection = "adminRoles";
}
