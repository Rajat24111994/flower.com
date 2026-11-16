using Microsoft.AspNetCore.Http;

namespace FlowerFlow.Application.Common.Http;

/// <summary>Identity set by the trusted local-server middleware. The key is private, so HTTP input cannot supply it.</summary>
public static class LocalIdentityContext
{
    private static readonly object LocalIdentityKey = new();
    public sealed record LocalIdentity(FirebaseIdentity? Account, bool Presented);

    public static void SetLocalIdentity(HttpContext context, FirebaseIdentity? account, bool presented) =>
        context.Items[LocalIdentityKey] = new LocalIdentity(account, presented);

    public static bool HasLocalIdentity(HttpContext context) => context.Items.ContainsKey(LocalIdentityKey);

    public static bool TryGet(HttpContext context, out LocalIdentity local)
    {
        if (context.Items.TryGetValue(LocalIdentityKey, out var value) && value is LocalIdentity identity) { local = identity; return true; }
        local = null!; return false;
    }
}
