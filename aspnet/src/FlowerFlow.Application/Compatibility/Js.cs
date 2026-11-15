using System.Globalization;
using System.Text.Json;

namespace FlowerFlow.Application.Compatibility;

/// <summary>Explicit JS coercions used by the legacy backend; HTTP input is never trusted as a typed DTO.</summary>
public static class Js
{
    public static JsonElement Get(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(key, out var property) ? property : default;
    public static bool IsString(JsonElement value) => value.ValueKind == JsonValueKind.String;
    public static bool IsTrue(JsonElement value) => value.ValueKind == JsonValueKind.True;
    public static bool Truthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.False => false,
        JsonValueKind.String => value.GetString()!.Length > 0,
        JsonValueKind.Number => value.GetDouble() != 0 && !double.IsNaN(value.GetDouble()),
        _ => true
    };
    public static string StringOrEmpty(JsonElement value) => Truthy(value) ? String(value) : "";
    public static string String(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => "undefined", JsonValueKind.Null => "null", JsonValueKind.True => "true", JsonValueKind.False => "false",
        JsonValueKind.String => value.GetString()!, JsonValueKind.Object => "[object Object]",
        JsonValueKind.Array => string.Join(",", value.EnumerateArray().Select(item => item.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" : String(item))),
        JsonValueKind.Number => NumberString(value.GetDouble()), _ => "undefined"
    };
    public static double Number(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => double.NaN, JsonValueKind.Null or JsonValueKind.False => 0, JsonValueKind.True => 1,
        JsonValueKind.Number => value.GetDouble(), JsonValueKind.String or JsonValueKind.Array => ParseNumber(String(value)), _ => double.NaN
    };
    public static double NumberOrZero(JsonElement value) { var number = Number(value); return number == 0 || double.IsNaN(number) ? 0 : number; }
    public static bool Integer(double value) => double.IsFinite(value) && Math.Truncate(value) == value;
    public static bool SafeInteger(double value) => Integer(value) && Math.Abs(value) <= 9_007_199_254_740_991d;
    public static bool SafeInteger(JsonElement value) => value.ValueKind == JsonValueKind.Number && SafeInteger(value.GetDouble());
    public static double Round(double value) => Math.Floor(value + 0.5);
    public static string Cut(string value, int length) => value[..Math.Min(value.Length, length)];

    private static double ParseNumber(string text)
    {
        text = text.Trim().Trim('\ufeff').Trim();
        if (text.Length == 0) return 0;
        if (text is "Infinity" or "+Infinity") return double.PositiveInfinity;
        if (text == "-Infinity") return double.NegativeInfinity;
        if (text.Contains("infinity", StringComparison.OrdinalIgnoreCase)) return double.NaN;
        if (text.Length > 2 && text[0] == '0' && "xXbBoO".Contains(text[1]))
        {
            var radix = char.ToLowerInvariant(text[1]) switch { 'x' => 16, 'b' => 2, _ => 8 };
            double total = 0;
            foreach (var character in text[2..])
            {
                var digit = character is >= '0' and <= '9' ? character - '0' : char.ToLowerInvariant(character) - 'a' + 10;
                if (digit < 0 || digit >= radix) return double.NaN;
                total = total * radix + digit;
            }
            return total;
        }
        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : double.NaN;
    }
    private static string NumberString(double number)
    {
        if (number == 0) return "0";
        if (Math.Abs(number) is >= 0.000001 and < 1e21) return number.ToString("0.##############################", CultureInfo.InvariantCulture);
        var text = number.ToString("G", CultureInfo.InvariantCulture).Replace('E', 'e');
        return System.Text.RegularExpressions.Regex.Replace(text, @"e([+-])0+([0-9])", "e$1$2");
    }
}
