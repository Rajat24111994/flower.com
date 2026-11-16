using System.Collections;
using System.Globalization;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Google.Cloud.Firestore;

namespace Flower.Api;

public static class Data
{
    public static Dictionary<string, object> Map(params object[] pairs)
    {
        var map = new Dictionary<string, object>();
        for (var i = 0; i < pairs.Length; i += 2)
        {
            var value = pairs[i + 1];
            map[(string)pairs[i]] = value is double number && Safe(number) ? (object)(long)number : value;
        }
        return map;
    }
    public static Dictionary<string, object> Obj(object? value) => value as Dictionary<string, object> ?? new();
    public static object? Get(this IDictionary<string, object> map, string key) => map.TryGetValue(key, out var value) ? value : null;
    public static string Str(object? value) => value switch { null => "", bool b => b ? "true" : "false", IFormattable f => f.ToString(null, CultureInfo.InvariantCulture), _ => value.ToString() ?? "" };
    public static string S(this IDictionary<string, object> map, string key, string fallback = "") => map.Get(key) is { } value ? Str(value) : fallback;
    public static bool B(this IDictionary<string, object> map, string key) => map.Get(key) is true;
    public static bool Truthy(object? value) => value switch { null => false, bool b => b, string s => s.Length > 0, double d => d != 0 && !double.IsNaN(d), long l => l != 0, int i => i != 0, _ => true };
    public static string Or(this IDictionary<string, object> map, string key, string fallback = "") => Truthy(map.Get(key)) ? Str(map.Get(key)) : fallback;
    public static double Num(object? value) => value switch
    {
        null => 0, bool b => b ? 1 : 0, string s when string.IsNullOrWhiteSpace(s) => 0,
        _ => double.TryParse(Str(value), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : double.NaN
    };
    public static double N(this IDictionary<string, object> map, string key) => Num(map.Get(key));
    public static bool Safe(object? value) => value is not (null or string or bool) && double.IsFinite(Num(value)) && Math.Truncate(Num(value)) == Num(value) && Math.Abs(Num(value)) <= 9007199254740991;
    public static List<object> Arr(object? value) => value is IEnumerable list and not string and not IDictionary ? list.Cast<object>().ToList() : new();
    public static List<Dictionary<string, object>> Rows(object? value) => Arr(value).Select(Obj).ToList();
    public static double Round(double value) => Math.Floor(value + 0.5);
    public static Timestamp Now() => Timestamp.FromDateTime(DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).UtcDateTime);
    public static double Vnd(object? value)
    {
        var price = Num(value);
        return !double.IsFinite(price) || price < 0 ? 0 : price > 0 && price < 1000 ? Round(price * 25949.123093 / 1000) * 1000 : Round(price);
    }
    public static string Iso(object? value) => value is Timestamp timestamp ? timestamp.ToDateTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) : value as string ?? "";
    public static object? JsonSafe(object? value) => value switch
    {
        Timestamp t => Iso(t), IDictionary<string, object> map => map.ToDictionary(pair => pair.Key, pair => JsonSafe(pair.Value)),
        IEnumerable list when value is not string && value is not byte[] => list.Cast<object>().Select(JsonSafe).ToArray(), _ => value
    };
    public static Dictionary<string, object> Read(DocumentSnapshot snapshot) => snapshot.Exists ? snapshot.ToDictionary() : new();
    public static async Task<Dictionary<string, object>> Body(HttpContext context)
    {
        if (context.Request.ContentLength == 0 || context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature>()?.CanHaveBody == false) return new();
        try
        {
            using var json = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            if (json.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
            var body = Obj(Convert(json.RootElement));
            context.Items["api-action"] = body.S("action");
            return body;
        }
        catch (JsonException) { throw new ApiException(400, "invalid-argument", "Nội dung yêu cầu không hợp lệ."); }
    }
    private static object Convert(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().ToDictionary(p => p.Name, p => Convert(p.Value)),
        JsonValueKind.Array => value.EnumerateArray().Select(Convert).ToList(),
        JsonValueKind.String => value.GetString()!, JsonValueKind.Number => value.TryGetInt64(out var integer) ? (object)integer : value.GetDouble(),
        JsonValueKind.True => true, JsonValueKind.False => false, _ => null!
    };
    public static ApiException Error(string code, string message, int status = 409) => new(status, code, message);
    public static void Require([DoesNotReturnIf(false)] bool condition, string code, string message, int status = 400)
    {
        if (!condition) throw Error(code, message, status);
    }
    public static string Cut(string text, int max) => text[..Math.Min(text.Length, max)];
}
