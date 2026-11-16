using System.Text.Json;
using System.Text.RegularExpressions;
using static Flower.Api.Data;

namespace Flower.Api;

public sealed class ProductEndpoints(FirebaseServices firebase)
{
    private readonly Lazy<Dictionary<string, Dictionary<string, object>>> catalog = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "flower.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        return document.RootElement.GetProperty("flower").EnumerateArray().ToDictionary(row => row.GetProperty("id").ToString(), row => Map("title", row.GetProperty("title").GetString()!, "image", row.GetProperty("image").GetString()!));
    });
    public static bool LegacyImage(string value)
    {
        if (!Uri.TryCreate(new Uri("https://flowerflow.invalid"), value.Trim(), out var uri)) return false;
        return Regex.IsMatch(uri.AbsolutePath, @"/img/p/GEN/lgwt/\d+\.jpg$|^/images/flower-0[1-6]\.webp$", RegexOptions.IgnoreCase);
    }
    public async Task Handle(HttpContext context)
    {
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = "GET";
            throw Error("method-not-allowed", "API này chỉ chấp nhận GET.", 405);
        }
        var db = firebase.Db;
        var manage = context.Request.Query["manage"] == "1";
        if (manage)
        {
            var user = await firebase.Verify(context);
            Require(UserEndpoints.IsAdmin(user.Claims) && (await db.Collection("adminRoles").Document(user.Uid).GetSnapshotAsync()).Exists,
                "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới xem được toàn bộ sản phẩm.", 403);
        }
        var snapshot = await db.Collection("products").GetSnapshotAsync();
        var products = snapshot.Documents.Select(doc =>
        {
            var data = doc.ToDictionary();
            if (data.Get("id") == null) data["id"] = doc.Id;
            if (catalog.Value.TryGetValue(Str(data["id"]), out var original))
            {
                if (data.Get("title") is string title && title.Contains('?')) data["title"] = original["title"];
                if (LegacyImage(data.S("image")))
                {
                    data["image"] = original["image"];
                    if (data.Get("images") is System.Collections.IList) data["images"] = Arr(data["images"]).Where(image => !LegacyImage(Str(image))).ToList();
                }
            }
            return data;
        }).Where(product => manage || product.S("status") != "hidden").ToArray();
        context.Response.Headers.CacheControl = manage ? "private, no-store" : "public, max-age=0, s-maxage=0, must-revalidate";
        await context.Response.WriteAsJsonAsync(new { products = JsonSafe(products) });
    }
}
