using System.Globalization;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using static Flower.Api.Data;

namespace Flower.Api;

public sealed class CatalogEndpoints(FirebaseServices firebase)
{
    public static bool FlowerId(string id) => id.Length is > 0 and <= 128 && id.Trim() == id && !Regex.IsMatch(id, @"[/\x00-\x1f\x7f]");
    public static List<Dictionary<string, object>>? Tiers(object? input)
    {
        if (input is not System.Collections.IList) return null;
        var rows = Rows(input);
        if (rows.Count is < 1 or > 10) return null;
        double previous = 0;
        foreach (var row in rows)
        {
            if (!Safe(row.Get("maxStems")) || row.N("maxStems") <= previous || row.N("maxStems") > 50
                || !Safe(row.Get("fee")) || row.N("fee") < 0 || row.N("fee") > 1e9) return null;
            previous = row.N("maxStems");
        }
        return previous == 50 ? rows.Select(row => Map("maxStems", row.N("maxStems"), "fee", row.N("fee"))).ToList() : null;
    }
    public static Dictionary<string, object>? Zone(Dictionary<string, object> value)
    {
        var id = value.S("id").Trim(); var province = value.S("province").Trim(); var district = value.S("district").Trim();
        return Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,80}$") && province.Length is > 0 and <= 120 && district.Length is > 0 and <= 120
            && Safe(value.Get("fee")) && value.N("fee") >= 0 && value.N("fee") <= 1e9 && value.Get("enabled") is bool
            ? Map("id", id, "province", province, "district", district, "fee", value.N("fee"), "enabled", value.B("enabled")) : null;
    }
    public async Task Metadata(HttpContext context, string name)
    {
        var wrapping = name == "bouquetWrapping";
        var db = firebase.Db;
        var reference = db.Collection("metadata").Document(name);
        if (context.Request.Method == "GET")
        {
            if (context.Request.Query["manage"] == "1") await Admin(context);
            var data = Read(await reference.GetSnapshotAsync());
            if (wrapping)
            {
                var tiers = Tiers(data.Get("tiers")) ?? new();
                await context.Response.WriteAsJsonAsync(new { configured = tiers.Count > 0, tiers });
            }
            else
            {
                var zones = Rows(data.Get("zones")).Select(Zone).Where(z => z != null).Select(z => z!).ToList();
                await context.Response.WriteAsJsonAsync(new { configured = zones.Any(z => z.B("enabled")), zones = context.Request.Query["manage"] == "1" ? zones : zones.Where(z => z.B("enabled")).ToList() });
            }
            return;
        }
        if (context.Request.Method != "POST")
        {
            context.Response.Headers.Allow = "GET, POST";
            throw Error("method-not-allowed", wrapping ? "API phí bó hoa chỉ chấp nhận GET hoặc POST." : "API khu vực giao hàng chỉ chấp nhận GET hoặc POST.", 405);
        }
        await Admin(context);
        var body = await Body(context);
        if (wrapping)
        {
            var tiers = Tiers(body.Get("tiers"));
            Require(tiers != null, "invalid-bouquet-wrapping", "Bậc phí phải tăng dần theo số cành, mức cuối phải áp dụng đến 50 cành; phí là số nguyên VND không âm.");
            await reference.SetAsync(Map("tiers", tiers!, "updatedAt", FieldValue.ServerTimestamp));
            await context.Response.WriteAsJsonAsync(new { configured = true, tiers });
            return;
        }
        var action = body.S("action");
        Require(action is "upsert" or "delete", "invalid-delivery-zone", "Thao tác khu vực giao hàng không hợp lệ.");
        var zone = action == "upsert" ? Zone(Obj(body.Get("zone"))) : null;
        var zoneId = action == "delete" ? body.S("id").Trim() : zone?.S("id") ?? "";
        Require(Regex.IsMatch(zoneId, "^[A-Za-z0-9_-]{1,80}$") && (action != "upsert" || zone != null), "invalid-delivery-zone", "Vui lòng nhập tên tỉnh/thành, quận/huyện và phí giao hợp lệ.");
        var updated = await db.RunTransactionAsync(async transaction =>
        {
            var data = Read(await transaction.GetSnapshotAsync(reference));
            var zones = Rows(data.Get("zones")).Select(Zone).Where(z => z != null && z.S("id") != zoneId).Select(z => z!).ToList();
            if (zone != null) zones.Add(zone);
            var vi = CultureInfo.GetCultureInfo("vi-VN");
            Require(zones.Select(z => z.S("province").ToLower(vi) + "\0" + z.S("district").ToLower(vi)).Distinct().Count() == zones.Count,
                "duplicate-delivery-zone", "Khu vực tỉnh/thành và quận/huyện này đã được khai báo.", 409);
            transaction.Set(reference, Map("zones", zones, "updatedAt", FieldValue.ServerTimestamp));
            return zones;
        });
        await context.Response.WriteAsJsonAsync(new { configured = updated.Any(z => z.B("enabled")), zones = updated });
    }

    public async Task Prices(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        if (context.Request.Method is not ("GET" or "PATCH"))
        {
            context.Response.Headers.Allow = "GET, PATCH";
            throw Error("method-not-allowed", "API chỉ chấp nhận GET hoặc PATCH.", 405);
        }
        var token = await firebase.Verify(context);
        Require(UserEndpoints.IsAdmin(token.Claims) && token.Claims.TryGetValue("role", out var role) && role is "owner", "permission-denied", "Chỉ chủ cửa hàng mới được quản lý giá hoa.", 403);
        var db = firebase.Db;
        var owner = Read(await db.Collection("adminRoles").Document(token.Uid).GetSnapshotAsync());
        Require(owner.S("role") == "owner", "permission-denied", "Tài khoản không còn quyền Owner.", 403);
        if (context.Request.Method == "GET")
        {
            if (context.Request.Query.ContainsKey("flowerId"))
            {
                var id = context.Request.Query["flowerId"].ToString();
                Require(context.Request.Query["flowerId"].Count == 1 && FlowerId(id), "invalid-argument", "Mã hoa không hợp lệ.");
                var flower = Read(await db.Collection("products").Document(id).GetSnapshotAsync());
                Require(flower.S("saleType") == "flower", "flower-not-found", "Không tìm thấy loại hoa.", 404);
                var history = await db.Collection("priceHistory").WhereEqualTo("flowerId", id).GetSnapshotAsync();
                var entries = history.Documents.Select(doc =>
                {
                    var data = doc.ToDictionary();
                    return Map("id", doc.Id, "oldPrice", data.N("oldPrice"), "newPrice", data.N("newPrice"), "updatedAt", Iso(data.Get("updatedAt")), "updatedBy", data.S("updatedByEmail", data.S("updatedBy")));
                }).OrderByDescending(row => row.S("updatedAt")).ToList();
                await context.Response.WriteAsJsonAsync(new { history = entries });
            }
            else
            {
                var flowers = await db.Collection("products").WhereEqualTo("saleType", "flower").GetSnapshotAsync();
                await context.Response.WriteAsJsonAsync(new { flowers = flowers.Documents.Select(doc => SerializeFlower(doc.Id, doc.ToDictionary())).OrderBy(row => row.S("name"), StringComparer.Create(CultureInfo.GetCultureInfo("vi-VN"), false)) });
            }
            return;
        }
        var body = await Body(context);
        var flowerId = body.S("flowerId"); var price = body.Get("price");
        Require(body.Get("flowerId") is string && FlowerId(flowerId) && Safe(price) && Num(price) >= 1000 && Num(price) <= 1e9, "invalid-argument", "Mã hoa hoặc giá bán không hợp lệ.");
        var productRef = db.Collection("products").Document(flowerId);
        var historyRef = db.Collection("priceHistory").Document();
        var now = DateTime.UtcNow;
        var email = Cut(token.Claims.TryGetValue("email", out var emailValue) ? Str(emailValue) : "", 320);
        var result = await db.RunTransactionAsync(async transaction =>
        {
            var product = Read(await transaction.GetSnapshotAsync(productRef));
            Require(product.S("saleType") == "flower", "flower-not-found", "Không tìm thấy loại hoa.", 404);
            var oldPrice = Vnd(product.Get("price"));
            Require(oldPrice >= 1000 && oldPrice <= 1e9, "invalid-current-price", "Giá hiện tại của loại hoa không hợp lệ.");
            var flower = SerializeFlower(flowerId, product);
            if (oldPrice == Num(price)) return Map("changed", false, "flower", flower);
            var localDate = TimeZoneInfo.ConvertTimeFromUtc(now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).ToString("yyyy-MM-dd");
            transaction.Update(productRef, Map("price", price!, "priceUpdatedAt", localDate, "priceChangedAt", FieldValue.ServerTimestamp, "priceUpdatedBy", token.Uid));
            transaction.Create(historyRef, Map("flowerId", flowerId, "oldPrice", oldPrice, "newPrice", price!, "updatedAt", FieldValue.ServerTimestamp, "updatedBy", token.Uid, "updatedByEmail", email));
            flower["price"] = price!; flower["priceUpdatedAt"] = now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"); flower["updatedBy"] = email.Length > 0 ? email : token.Uid;
            return Map("changed", true, "flower", flower);
        });
        await context.Response.WriteAsJsonAsync(result);
    }
    public static Dictionary<string, object> SerializeFlower(string id, Dictionary<string, object> data) => Map("flowerId", id, "name", data.S("title"), "image", data.S("image"), "unit", data.S("unit", "cành"), "price", Vnd(data.Get("price")), "priceUpdatedAt", Iso(data.Get("priceChangedAt")) is { Length: > 0 } date ? date : data.S("priceUpdatedAt"), "updatedBy", data.S("priceUpdatedByEmail", data.S("priceUpdatedBy")));
    private async Task Admin(HttpContext context)
    {
        var token = await firebase.Verify(context);
        Require(UserEndpoints.IsAdmin(token.Claims), "permission-denied", "Bạn cần quyền quản trị để thực hiện thao tác này.", 403);
    }
}
