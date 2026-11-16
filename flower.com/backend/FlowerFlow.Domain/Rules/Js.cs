using System.Globalization;
using System.Text.Json;

namespace FlowerFlow.Domain.Rules;

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
    public static JsonElement Element(object? value) => value is JsonElement element ? element : JsonSerializer.SerializeToElement(value);
    public static object? Object(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().ToDictionary(property => property.Name, property => Object(property.Value)!),
        JsonValueKind.Array => value.EnumerateArray().Select(Object).ToList(),
        JsonValueKind.String => value.GetString(), JsonValueKind.Number => value.GetDouble(),
        JsonValueKind.True => true, JsonValueKind.False => false, _ => null
    };

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
        var text = number.ToString("R", CultureInfo.InvariantCulture).Replace('E', 'e');
        if (Math.Abs(number) is >= 0.000001 and < 1e21 && text.Contains('e'))
        {
            var parts = text.Split('e'); var negative = parts[0].StartsWith('-');
            var coefficient = parts[0].TrimStart('-'); var dot = coefficient.IndexOf('.');
            var digits = coefficient.Replace(".", "");
            var position = (dot < 0 ? coefficient.Length : dot) + int.Parse(parts[1], CultureInfo.InvariantCulture);
            var expanded = position <= 0 ? "0." + new string('0', -position) + digits
                : position >= digits.Length ? digits + new string('0', position - digits.Length) : digits.Insert(position, ".");
            return (negative ? "-" : "") + expanded;
        }
        return System.Text.RegularExpressions.Regex.Replace(text, @"e([+-])0+([0-9])", "e$1$2");
    }
}
