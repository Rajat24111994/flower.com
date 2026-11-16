using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace FlowerFlow.Infrastructure.Local;

public sealed record BackendServerOptions(string Root, bool Development, string? AuthMode = null, IReadOnlyList<string>? MissingLoginConfiguration = null)
{
    public IReadOnlySet<string> PublicOrigins { get; init; } = new HashSet<string>(StringComparer.Ordinal);
    public IReadOnlySet<string> ApiPaths { get; init; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "/api/review-images", "/api/product-images", "/api/admin/audit", "/api/bouquet-wrapping", "/api/delivery-zones", "/api/flower-prices",
        "/api/products", "/api/design-requests", "/api/login", "/api/auth/logout-all", "/api/admin/users", "/api/owner/users", "/api/orders", "/api/payments", "/api/vnpay-ipn"
    };
}

// Port of lib/local-server.js. Runs before routing so decoded paths keep Node's URL semantics.
public sealed class BackendServer
{
    private readonly RequestDelegate _next;
    private readonly BackendServerOptions _options;
    private readonly string _root;
    private readonly string _realRoot;
    private readonly string _policy;
    private readonly ILocalAccountWorker? _accounts;
    private readonly LocalAuthHandler? _localAuth;
    private readonly Dictionary<string, Dictionary<string, string>> _rewrites = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8", [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml", [".png"] = "image/png", [".webp"] = "image/webp", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif",
        [".ico"] = "image/x-icon", [".woff"] = "font/woff", [".woff2"] = "font/woff2", [".xml"] = "application/xml; charset=utf-8", [".txt"] = "text/plain; charset=utf-8"
    };
    private sealed class InputException(int status, string code, string message) : Exception(message)
    { public int Status { get; } = status; public string Code { get; } = code; }
    private static bool Match(string value, string pattern, RegexOptions flags = RegexOptions.None) => Regex.IsMatch(value, pattern, flags | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(2));
    public BackendServer(RequestDelegate next, BackendServerOptions options, ILocalAccountWorker? accounts = null, LocalAuthHandler? localAuth = null)
    {
        _next = next; _options = options; _accounts = accounts; _localAuth = localAuth;
        _root = Path.GetFullPath(options.Root); _realRoot = RealPath(_root);
        using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(_root, "vercel.json")));
        var policy = config.RootElement.GetProperty("headers")[0].GetProperty("headers").EnumerateArray()
            .First(header => header.GetProperty("key").GetString() == "Content-Security-Policy").GetProperty("value").GetString()!;
        _policy = ContentSecurity.WithSecurityPolicy(policy, _root);
        if (options.Development) _policy = Regex.Replace(_policy, @";?\s*upgrade-insecure-requests", "")
            .Replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099 http://localhost:8080 http://localhost:9099")
            .Replace("frame-src ", "frame-src http://127.0.0.1:9099 http://localhost:9099 ");
        foreach (var rule in config.RootElement.GetProperty("rewrites").EnumerateArray())
        {
            var source = rule.GetProperty("source").GetString()!;
            if (!source.StartsWith("/api/", StringComparison.Ordinal) || Match(source, @"[:*(]")) continue;
            var destination = new Uri("http://local.invalid" + rule.GetProperty("destination").GetString());
            _rewrites[source] = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(destination.Query).ToDictionary(pair => pair.Key, pair => pair.Value.ToString());
        }
    }
    public static bool IsPublicFile(string pathname)
    {
        if (pathname.Contains('\\') || pathname.Split('/').Any(part => part.StartsWith('.'))) return false;
        if (Match(pathname, @"^/(?:js|css|images)/")) return Match(pathname, @"\.(?:js|css|svg|png|webp|jpe?g|gif|ico|woff2?)\z", RegexOptions.IgnoreCase);
        return Match(pathname, @"\A/[a-z0-9-]+\.html\z", RegexOptions.IgnoreCase) || pathname is "/flower.json" or "/favicon.svg" or "/robots.txt" or "/sitemap.xml";
    }
    private static string RealPath(string path)
    {
        var full = Path.GetFullPath(path); var current = Path.GetPathRoot(full)!;
        foreach (var part in full[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (!info.Exists) throw new FileNotFoundException();
            if (info.LinkTarget is not null) current = info.ResolveLinkTarget(true)?.FullName ?? throw new FileNotFoundException();
        }
        return current;
    }
    private static string DecodePath(HttpContext context)
    {
        var target = context.Features.Get<IHttpRequestFeature>()?.RawTarget;
        if (string.IsNullOrEmpty(target)) target = context.Request.Path.ToUriComponent() + context.Request.QueryString;
        var raw = target.Split('?')[0];
        if (Match(raw, @"%(?![0-9a-fA-F]{2})")) throw new UriFormatException();
        var parsed = new Uri("http://local.invalid" + raw);
        var escaped = parsed.GetComponents(UriComponents.Path | UriComponents.KeepDelimiter, UriFormat.UriEscaped);
        using var bytes = new MemoryStream();
        for (var index = 0; index < escaped.Length; index++)
        {
            if (escaped[index] == '%') { bytes.WriteByte(byte.Parse(escaped.AsSpan(index + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); index += 2; }
            else foreach (var value in Encoding.UTF8.GetBytes(escaped[index].ToString())) bytes.WriteByte(value);
        }
        return new UTF8Encoding(false, true).GetString(bytes.ToArray());
    }
    private static async Task ReadBodyAsync(HttpContext context, int limit)
    {
        using var buffer = new MemoryStream(); var chunk = new byte[8192]; long size = 0; int count;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var receive = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, timeout.Token);
        try
        {
            while ((count = await context.Request.Body.ReadAsync(chunk, receive.Token)) != 0)
            { size += count; if (size <= limit) buffer.Write(chunk, 0, count); }
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
        { throw new InputException(408, "request-timeout", "Yêu cầu gửi lên quá thời gian chờ."); }
        if (size > limit) throw new InputException(413, "payload-too-large", "Dữ liệu gửi lên vượt giới hạn.");
        if (size > 0 && !Match(context.Request.ContentType ?? "", @"^application/json(?:\s*;|\z)", RegexOptions.IgnoreCase))
            throw new InputException(415, "unsupported-media-type", "API yêu cầu dữ liệu JSON.");
        try
        {
            using var document = JsonDocument.Parse(size == 0 ? "{}" : Encoding.UTF8.GetString(buffer.ToArray()), new JsonDocumentOptions { MaxDepth = int.MaxValue });
            JsonInput.Cache(context, document.RootElement.Clone());
        }
        catch (JsonException) { throw new InputException(400, "invalid-json", "Dữ liệu JSON không hợp lệ."); }
    }
    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store"; context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.XFrameOptions = "DENY"; context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        context.Response.Headers.ContentSecurityPolicy = _policy;
        if (!_options.Development) context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(self)";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        Task Missing() => Error(404, "not-found", "Không tìm thấy nội dung.");
        try
        {
            var host = context.Request.Host.Value ?? "";
            var remote = context.Connection.RemoteIpAddress;
            if (_options.Development && (!Match(host, @"\A(?:localhost|127\.0\.0\.1):[0-9]+\z")
                || (remote is not null && !System.Net.IPAddress.IsLoopback(remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote))))
            { await Error(403, "local-host-required", "Máy chủ này chỉ hỗ trợ địa chỉ localhost."); return; }
            var pathname = DecodePath(context);
            if (pathname.Contains('\\') || pathname.Contains('\0')) { await Missing(); return; }
            context.Request.Path = pathname;
            if (_options.Development && _options.AuthMode is not null && pathname == "/__local/auth-runtime.js" && context.Request.Method is "GET" or "HEAD")
            {
                context.Response.ContentType = "text/javascript; charset=utf-8";
                if (context.Request.Method != "HEAD") await context.Response.WriteAsync("window.FlowerAuthMode = " + JsonSerializer.Serialize(_options.AuthMode) + ";", context.RequestAborted);
                return;
            }
            if (pathname.StartsWith("/api/", StringComparison.Ordinal))
            {
                var origin = context.Request.Headers.Origin.ToString();
                var sameOrigin = origin == $"{context.Request.Scheme}://{host}"
                    || (!_options.Development && _options.PublicOrigins.Contains(origin));
                if (origin.Length > 0 && !sameOrigin)
                { await Error(403, "same-origin-required", "Hãy mở giao diện từ cùng địa chỉ máy chủ API."); return; }
                var route = pathname[5..];
                if (!Match(route, @"\A(?:[a-z0-9-]+/)*[a-z0-9-]+\z") || (!_options.ApiPaths.Contains(pathname) && !(_localAuth is not null && route.StartsWith("local-auth/", StringComparison.Ordinal))))
                { await Error(404, "api-not-found", "Không tìm thấy API."); return; }
                if (_rewrites.TryGetValue(pathname, out var rewrite))
                {
                    var query = context.Request.Query.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
                    foreach (var pair in rewrite) query[pair.Key] = pair.Value;
                    context.Request.QueryString = QueryString.Create(query); context.Request.Query = new QueryCollection(query);
                }
                await ReadBodyAsync(context, route == "login" || route.StartsWith("local-auth/", StringComparison.Ordinal) ? 32 * 1024 : 4 * 1024 * 1024);
                if (route == "login" && context.Request.Method == "POST" && _options.MissingLoginConfiguration is { Count: > 0 })
                { await Error(503, "login-not-configured", $"Đăng nhập Firebase thật chưa được cấu hình: thiếu {string.Join(", ", _options.MissingLoginConfiguration)} trong .env. Hoàn tất cấu hình rồi khởi động lại máy chủ."); return; }
                // ForwardedHeaders middleware may first resolve an explicitly trusted proxy.
                context.Request.Headers["x-forwarded-for"] = context.Connection.RemoteIpAddress?.ToString();
                if (_localAuth is not null && route.StartsWith("local-auth/", StringComparison.Ordinal))
                { await _localAuth.HandleAsync(context, route[11..]); return; }
                if (_accounts is not null && route != "login")
                {
                    var token = LocalSession.SessionCookie(context); var account = token is { Length: > 0 } ? await _accounts.SessionAsync(token) : null;
                    RequestIdentity.SetLocalIdentity(context, account is null ? null : new FirebaseIdentity((string)account["uid"], account), token is not null);
                }
                await _next(context); return;
            }
            if (pathname == "/health") { await _next(context); return; }
            if (context.Request.Method is not "GET" and not "HEAD")
            { context.Response.Headers.Allow = "GET, HEAD"; await Error(405, "method-not-allowed", "Phương thức không được hỗ trợ."); return; }
            var publicPath = pathname == "/" ? "/index.html" : pathname;
            if (!IsPublicFile(publicPath)) { await Missing(); return; }
            string filename;
            try { filename = RealPath(Path.Combine(_root, publicPath[1..].Replace('/', Path.DirectorySeparatorChar))); }
            catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException) { await Missing(); return; }
            var relative = Path.GetRelativePath(_realRoot, filename);
            if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative) || !IsPublicFile("/" + relative.Replace(Path.DirectorySeparatorChar, '/')))
            { await Missing(); return; }
            var bytes = await File.ReadAllBytesAsync(filename, context.RequestAborted); var extension = Path.GetExtension(filename);
            if (_options.Development && _options.AuthMode is not null && extension.Equals(".html", StringComparison.OrdinalIgnoreCase))
                bytes = Encoding.UTF8.GetBytes(new Regex(@"<head(?:\s[^>]*)?>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))
                    .Replace(Encoding.UTF8.GetString(bytes), "$&\n<script src=\"/__local/auth-runtime.js\"></script>", 1));
            context.Response.ContentType = ContentTypes.GetValueOrDefault(extension) ?? "application/octet-stream";
            if (!_options.Development)
                context.Response.Headers.CacheControl = extension.ToLowerInvariant() switch
                {
                    ".css" or ".js" or ".woff" or ".woff2" => "public, max-age=31536000, immutable",
                    ".webp" or ".png" or ".jpg" or ".jpeg" or ".svg" or ".ico" => "public, max-age=86400, must-revalidate",
                    ".html" or ".json" or ".xml" or ".txt" => "public, max-age=0, must-revalidate",
                    _ => "no-store"
                };
            context.Response.ContentLength = bytes.Length;
            if (context.Request.Method != "HEAD") await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (context.Response.HasStarted) { context.Abort(); return; }
            if (error is InputException input) await Error(input.Status, input.Code, input.Message);
            else if (error is UriFormatException or DecoderFallbackException) await Error(400, "invalid-url", "Địa chỉ không hợp lệ.");
            else if (error is LocalAccountException { Status: 429 }) { context.Response.Headers.RetryAfter = "5"; await Error(429, "local-auth-busy", "Máy chủ bận. Vui lòng thử lại sau."); }
            else await Error(500, "local-server-error", "Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.");
        }
    }
}
