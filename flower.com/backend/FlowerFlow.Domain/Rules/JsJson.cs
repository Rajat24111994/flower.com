using System.Collections;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace FlowerFlow.Domain.Rules;

/// <summary>JSON.stringify compatibility for checkout fingerprints shared with the Node backend.</summary>
public static class JsJson
{
    public static string Stringify(object? value) { var text = new StringBuilder(); Write(text, value); return text.ToString(); }
    private static void Write(StringBuilder text, object? value)
    {
        switch (value)
        {
            case null: text.Append("null"); return;
            case string s: Quote(text, s); return;
            case bool b: text.Append(b ? "true" : "false"); return;
            case JsonElement element:
                switch (element.ValueKind)
                {
                    case JsonValueKind.Object:
                        var data = new Dictionary<string, object?>(); foreach (var property in element.EnumerateObject()) data[property.Name] = property.Value;
                        Object(text, data); return;
                    case JsonValueKind.Array: Array(text, element.EnumerateArray().Select(item => (object)item)); return;
                    case JsonValueKind.String: Quote(text, DecodeString(element)); return;
                    case JsonValueKind.Number: Number(text, element.GetDouble()); return;
                    case JsonValueKind.True: text.Append("true"); return;
                    case JsonValueKind.False: text.Append("false"); return;
                    default: text.Append("null"); return;
                }
            case IDictionary<string, object> dictionary: Object(text, dictionary.Select(pair => new KeyValuePair<string, object?>(pair.Key, pair.Value))); return;
            case IEnumerable sequence: Array(text, sequence.Cast<object?>()); return;
            case byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal:
                Number(text, Convert.ToDouble(value, CultureInfo.InvariantCulture)); return;
            default: throw new InvalidOperationException("Unsupported checkout fingerprint value.");
        }
    }
    private static void Number(StringBuilder text, double number) => text.Append(double.IsFinite(number) ? Js.String(Js.Element(number)) : "null");
    private static void Object(StringBuilder text, IEnumerable<KeyValuePair<string, object?>> data)
    {
        var pairs = data.Where(pair => pair.Value is not JsonElement { ValueKind: JsonValueKind.Undefined }).ToList();
        static uint? Index(string key) => uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var number)
            && number != uint.MaxValue && number.ToString(CultureInfo.InvariantCulture) == key ? number : null;
        var ordered = pairs.Where(pair => Index(pair.Key).HasValue).OrderBy(pair => Index(pair.Key)).Concat(pairs.Where(pair => !Index(pair.Key).HasValue));
        text.Append('{'); var first = true;
        foreach (var pair in ordered)
        { if (!first) text.Append(','); first = false; Quote(text, pair.Key); text.Append(':'); Write(text, pair.Value); }
        text.Append('}');
    }
    private static void Array(StringBuilder text, IEnumerable<object?> values)
    { text.Append('['); var first = true; foreach (var value in values) { if (!first) text.Append(','); first = false; Write(text, value); } text.Append(']'); }
    private static void Quote(StringBuilder text, string value)
    {
        text.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var ch = value[index];
            switch (ch)
            {
                case '"': text.Append("\\\""); break; case '\\': text.Append("\\\\"); break;
                case '\b': text.Append("\\b"); break; case '\f': text.Append("\\f"); break;
                case '\n': text.Append("\\n"); break; case '\r': text.Append("\\r"); break; case '\t': text.Append("\\t"); break;
                default:
                    var lone = char.IsHighSurrogate(ch) ? index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1])
                        : char.IsLowSurrogate(ch) && (index == 0 || !char.IsHighSurrogate(value[index - 1]));
                    if (ch < 32 || lone) text.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    else text.Append(ch); break;
            }
        }
        text.Append('"');
    }
    private static string DecodeString(JsonElement value)
    {
        try { return value.GetString()!; }
        catch (InvalidOperationException)
        {
            var raw = value.GetRawText(); var result = new StringBuilder();
            for (var i = 1; i < raw.Length - 1; i++)
            {
                if (raw[i] != '\\') { result.Append(raw[i]); continue; }
                var escape = raw[++i];
                if (escape == 'u') { result.Append((char)int.Parse(raw.AsSpan(i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); i += 4; }
                else result.Append(escape switch { 'b' => '\b', 'f' => '\f', 'n' => '\n', 'r' => '\r', 't' => '\t', _ => escape });
            }
            return result.ToString();
        }
    }
}
