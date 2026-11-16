using System.Text.RegularExpressions;

namespace FlowerFlow.Infrastructure.Http;

// ECMAScript whitespace differs from .NET's Unicode \s (notably FEFF and 0085).
// Preserve both legacy patterns: verifyRequest allows spaces inside the token;
// optionalCustomer requires one non-whitespace token. The SDK still verifies it.
internal static class BearerToken
{
    private const string White = @"\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
    // The JS patterns have no multiline flag and require the true end of input.
    // .NET $ would also accept a position before a final LF, so use \z.
    private const string End = @"\z";
    private static readonly Regex Request = Create(@"([^\r\n\u2028\u2029]+)");
    private static readonly Regex Customer = Create("([^" + White + "]+)");
    private static Regex Create(string token) => new(@"\ABearer[" + White + "]+" + token + End,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public static string? Read(string authorization, bool singleToken)
    {
        var match = (singleToken ? Customer : Request).Match(authorization);
        return match.Success ? match.Groups[1].Value : null;
    }
}
