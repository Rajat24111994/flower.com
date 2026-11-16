using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Catalog;

public sealed class ProductCatalog
{
    public IReadOnlyDictionary<string, Dictionary<string, object>> ById { get; }
    public ProductCatalog(string file)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(file));
        var products = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
        foreach (var product in document.RootElement.GetProperty("flower").EnumerateArray())
            products[Js.String(Js.Get(product, "id"))] = (Dictionary<string, object>)Js.Object(product)!;
        ById = products;
    }
}

/// <summary>Port of backend/catalog/products.js; preserves every Firestore product field and legacy catalog repairs.</summary>
public sealed class ProductsHandler(Func<FirestoreDb> database, FirebaseAdminService authentication, ProductCatalog catalog,
    FlowerPricesHandler prices, ILogger<ProductsHandler> logger)
{
    public static bool IsLegacyCatalogImage(object? value)
    {
        var image = Js.StringOrEmpty(Js.Element(value)).Trim();
        if (image.Length == 0) return false;
        try
        {
            if (!Uri.TryCreate(new Uri("https://flowerflow.invalid"), image, out var uri)) return false;
            return Regex.IsMatch(uri.AbsolutePath, @"/img/p/GEN/lgwt/[0-9]+\.jpg$", RegexOptions.IgnoreCase)
                || Regex.IsMatch(uri.AbsolutePath, @"\A/images/flower-0[1-6]\.webp\z", RegexOptions.IgnoreCase);
        }
        catch { return false; }
    }
    public Dictionary<string, object> SerializeProduct(string documentId, Dictionary<string, object> data)
    {
        var product = new Dictionary<string, object>(data) { ["id"] = data.GetValueOrDefault("id") ?? documentId };
        foreach (var key in product.Keys.ToArray()) if (product[key] is Timestamp timestamp) product[key] = FirestoreValues.ToIso(timestamp);
        if (catalog.ById.TryGetValue(Js.String(Js.Element(product["id"])), out var original))
        {
            if (product.GetValueOrDefault("title") is string title && title.Contains('?')) product["title"] = original["title"];
            if (IsLegacyCatalogImage(product.GetValueOrDefault("image")))
            {
                product["image"] = original["image"];
                if (product.GetValueOrDefault("images") is IEnumerable<object> images)
                    product["images"] = images.Where(image => !IsLegacyCatalogImage(image)).ToList();
            }
        }
        return product;
    }
    public Task HandleAsync(HttpContext context) => new ApiRoutes(HandleDefaultAsync,
        new Dictionary<string, RequestDelegate> { ["flower-prices"] = prices.HandleAsync }).InvokeAsync(context);

    private async Task HandleDefaultAsync(HttpContext context)
    {
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        if (context.Request.Method != "GET")
        { context.Response.Headers.Allow = "GET"; await Error(405, "method-not-allowed", "API này chỉ chấp nhận GET."); return; }
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình."); return; }
        try
        {
            var manage = context.Request.Query["manage"].ToString() == "1";
            if (manage)
            {
                var token = await authentication.VerifyRequestAsync(context); if (token is null) return;
                var role = await db.Collection("adminRoles").Document(token.Uid).GetSnapshotAsync(context.RequestAborted);
                if (!token.Claims.TryGetValue("admin", out var admin) || admin is not true || !role.Exists)
                { await Error(403, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới xem được toàn bộ sản phẩm."); return; }
            }
            var snapshot = await db.Collection("products").GetSnapshotAsync(context.RequestAborted);
            context.Response.Headers.CacheControl = manage ? "private, no-store" : "public, max-age=0, s-maxage=0, must-revalidate";
            var products = snapshot.Documents.Select(document => SerializeProduct(document.Id, document.ToDictionary()))
                .Where(product => manage || product.GetValueOrDefault("status") is not "hidden").Select(FirestoreValues.JsonCompatible).ToList();
            await context.Response.WriteAsJsonAsync(new { products }, context.RequestAborted);
        }
        catch { logger.LogError("Products API failed."); await Error(503, "product-service-unavailable", "Máy chủ chưa đọc được kho sản phẩm. Vui lòng thử lại sau."); }
    }
}
