using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace FlowerFlow.Infrastructure.Local;

public static class ContentSecurity
{
    private const string Space = @"[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]";
    private static readonly Regex Scripts = new(@"<script\b([^>]*)>([\s\S]*?)</script" + Space + "*>", RegexOptions.IgnoreCase | RegexOptions.ECMAScript | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(5));
    private static readonly Regex ExternalOrJson = new("\\bsrc" + Space + "*=|\\btype" + Space + "*=" + Space + "*[\"']application/(?:ld\\+)?json", RegexOptions.IgnoreCase | RegexOptions.ECMAScript | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    public static IReadOnlyList<string> InlineScriptHashes(string root)
    {
        var hashes = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var file in Directory.EnumerateFiles(root).Where(file => Path.GetFileName(file).EndsWith(".html", StringComparison.Ordinal)).Order(StringComparer.Ordinal))
        {
            var html = File.ReadAllText(file).Replace("\r\n", "\n").Replace('\r', '\n');
            foreach (Match match in Scripts.Matches(html))
            {
                var body = match.Groups[2].Value;
                if (ExternalOrJson.IsMatch(match.Groups[1].Value) || Regex.IsMatch(body, "\\A" + Space + "*\\z")) continue;
                hashes.Add("'sha256-" + Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(body))) + "'");
            }
        }
        return hashes.ToList();
    }
    public static string SetDirective(string policy, string name, IEnumerable<string> sources)
    {
        var rules = policy.Split(';').Select(rule => rule.Trim()).Where(rule => rule.Length > 0).ToList();
        static string Name(string rule) => Regex.Split(rule, @"\s+")[0];
        var index = rules.FindIndex(rule => Name(rule) == name);
        var other = rules.Where(rule => Name(rule) != name).ToList();
        other.Insert(index < 0 ? other.Count : Math.Min(index, other.Count), name + " " + string.Join(" ", sources));
        return string.Join("; ", other);
    }
    public static string WithScriptHashes(string policy, string root) => SetDirective(policy, "script-src",
        new[] { "'self'", "https://www.gstatic.com", "https://apis.google.com" }.Concat(InlineScriptHashes(root)));
    public static string WithSecurityPolicy(string policy, string root)
    {
        policy = WithScriptHashes(policy, root);
        policy = SetDirective(policy, "script-src-attr", ["'none'"]);
        policy = SetDirective(policy, "style-src", ["'self'", "https://fonts.googleapis.com"]);
        policy = SetDirective(policy, "style-src-attr", ["'none'"]);
        return SetDirective(policy, "img-src", ["'self'", "data:", "blob:", "https://firebasestorage.googleapis.com", "https://storage.googleapis.com", "https://*.googleusercontent.com", "https://img.vietqr.io"]);
    }
}
