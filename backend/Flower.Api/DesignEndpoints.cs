using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Google.Cloud.Firestore;
using static Flower.Api.Data;
using static Flower.Api.OrderRules;

namespace Flower.Api;

public sealed class DesignEndpoints(FirebaseServices firebase, OrderEndpoints orders)
{
    public static readonly string[] Statuses = ["Chờ tư vấn", "Chờ báo giá", "Chờ khách xác nhận", "Đang thực hiện", "Hoàn thành", "Đã hủy"];
    public static readonly string[] Colors = ["trắng", "đen", "kem", "hồng", "đỏ", "vàng", "cam", "xanh", "tím", "nhiều màu", "khác"];
    private static readonly Dictionary<string, string[]> Choices = new()
    {
        ["arrangement"] = ["Đối xứng", "Tự nhiên", "Hoa chính ở giữa", "Hoa xen kẽ"], ["size"] = ["Mini", "Nhỏ", "Vừa", "Lớn"],
        ["wrapStyle"] = ["Bó tròn", "Bó dài", "Bó một mặt", "Bó Hàn Quốc", "Bó tối giản", "Không gói"], ["paperMaterial"] = ["Giấy kraft", "Giấy nhám", "Giấy Hàn Quốc", "Giấy bóng kính"],
        ["bowStyle"] = ["Nơ nhỏ", "Nơ lớn", "Nơ lụa", "Không nơ"], ["theme"] = ["Sinh nhật", "Tình yêu", "Tốt nghiệp", "Khai trương", "Cảm ơn", "Kỷ niệm", "Ngày lễ", "Tự chọn"],
        ["style"] = ["Lãng mạn", "Sang trọng", "Dễ thương", "Tối giản", "Cổ điển", "Tự nhiên"], ["palette"] = ["Trắng - kem", "Hồng pastel", "Đỏ ấm", "Vàng tươi", "Xanh dịu", "Tím", "Nhiều màu"], ["greetingCardTemplate"] = ["Không cần thiệp", "Hoa lá", "Tối giản", "Chúc mừng", "Tình cảm"]
    };
    private static readonly Dictionary<string, int> Limits = new()
    {
        ["arrangement"] = 40, ["size"] = 20, ["wrapStyle"] = 40, ["paperMaterial"] = 40, ["paperColor"] = 30, ["bowStyle"] = 30, ["bowColor"] = 30, ["theme"] = 40, ["style"] = 40, ["palette"] = 40, ["greetingCardTemplate"] = 40, ["greetingCard"] = 300, ["fragrance"] = 30, ["specialRequest"] = 1500, ["deliveryNote"] = 500, ["quoteNote"] = 1000
    };
    private static string? Clean(string input, int max) => input.Trim().Length <= max ? input.Trim() : null;
    public static Dictionary<string, object>? Design(Dictionary<string, object> input)
    {
        var design = new Dictionary<string, object>();
        foreach (var pair in Limits)
        {
            var text = Clean(input.S(pair.Key), pair.Value); if (text == null) return null; if (text.Length > 0) design[pair.Key] = text;
        }
        var layers = Truthy(input.Get("paperLayers")) ? input.N("paperLayers") : 1;
        var main = input.S("mainProductId"); var budget = input.N("budget");
        var addons = Arr(input.Get("addons")).Select(Str).Where(v => new[] { "gấu bông nhỏ", "hộp quà", "túi quà", "chocolate", "hoa baby phụ" }.Contains(v)).Distinct().ToList();
        if (addons.Count != Arr(input.Get("addons")).Distinct().Count() || main.Length > 128 || main.Contains('/') || !Safe(layers) || layers is < 0 or > 5 || !Safe(budget) || budget is < 0 or > 1e9
            || Choices.Any(p => design.ContainsKey(p.Key) && !p.Value.Contains(design.S(p.Key))) || new[] { "paperColor", "bowColor" }.Any(k => design.ContainsKey(k) && !Colors.Contains(design.S(k).ToLowerInvariant()))) return null;
        foreach (var pair in Map("paperLayers", layers, "mainProductId", main, "greenery", input.B("greenery"), "addons", addons, "surprise", input.B("surprise"), "confirmBeforeMaking", input.Get("confirmBeforeMaking") is not false, "anonymousGreetingCard", input.B("anonymousGreetingCard"), "lowFragrance", input.B("lowFragrance"), "budget", budget)) design[pair.Key] = pair.Value;
        foreach (var key in new[] { "dislikedFlowers", "excludedFlowers" }) design[key] = Arr(input.Get(key)).Select(v => Str(v).Trim()).Where(v => v.Length is > 0 and <= 60).Distinct().Take(10).ToList();
        return design;
    }
    public static List<Dictionary<string, object>>? Stems(object? input)
    {
        if (input is not System.Collections.IList || Arr(input).Count > 20) return null;
        var result = new List<Dictionary<string, object>>(); var seen = new HashSet<string>();
        foreach (var item in Rows(input))
        {
            var id = item.S("productId").Trim(); var quantity = item.N("quantity"); var color = Clean(item.S("color"), 30); var role = item.Or("role", "support");
            if (id.Length is < 1 or > 128 || id.Contains('/') || !seen.Add(id) || !Safe(quantity) || quantity is < 1 or > 50 || color == null || !Colors.Contains(color.ToLowerInvariant()) || role is not ("main" or "support")) return null;
            result.Add(Map("productId", id, "quantity", quantity, "color", color, "role", role));
        }
        return result.Sum(i => i.N("quantity")) > 50 ? null : result;
    }
    public static string? Image(object? input)
    {
        if (input == null || input is "") return "";
        if (input is not string value || value.Length > 360000) return null;
        var match = Regex.Match(value, @"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$"); if (!match.Success) return null;
        byte[] bytes; try { bytes = Convert.FromBase64String(match.Groups[2].Value); } catch { return null; }
        if (bytes.Length is < 12 or > 250000 || Convert.ToBase64String(bytes) != match.Groups[2].Value) return null;
        var valid = match.Groups[1].Value switch { "png" => bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }), "jpeg" => bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255, _ => Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP" };
        return valid ? value : null;
    }
    public static bool Access(string token, object? saved)
    {
        if (token.Length is < 32 or > 100 || saved is not string hash || !Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$")) return false;
        return CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(token)), Convert.FromHexString(hash));
    }
    private static Dictionary<string, object> Public(string id, Dictionary<string, object> data)
    {
        var result = new Dictionary<string, object>(data); result.Remove("accessTokenHash");
        result["id"] = id; result["createdAt"] = Iso(data.Get("createdAt")); result["updatedAt"] = Iso(data.Get("updatedAt")); result["history"] = Rows(data.Get("history")); return result;
    }
    private static Dictionary<string, object> History(string status, string detail = "") => Map("status", status, "detail", Cut(detail, 500), "createdAt", Iso(Now()));
    private async Task Admin(HttpContext context)
    {
        var user = await firebase.Verify(context); Require(UserEndpoints.IsAdmin(user.Claims), "permission-denied", "Bạn cần quyền quản trị để xử lý yêu cầu thiết kế.", 403);
    }
    public async Task Handle(HttpContext context)
    {
        var db = firebase.Db;
        if (context.Request.Method == "GET")
        {
            if (context.Request.Query["manage"] == "1")
            {
                await Admin(context);
                var list = await db.Collection("designRequests").OrderByDescending("createdAt").Limit(100).GetSnapshotAsync();
                await context.Response.WriteAsJsonAsync(new { requests = JsonSafe(list.Documents.Select(d => Public(d.Id, d.ToDictionary())).ToList()) }); return;
            }
            var id = context.Request.Query["id"].ToString(); var token = context.Request.Query["token"].ToString();
            Require(Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,128}$") && token.Length > 0, "invalid-design-request", "Mã yêu cầu hoặc mã truy cập không hợp lệ.");
            var snapshot = await db.Collection("designRequests").Document(id).GetSnapshotAsync();
            Require(snapshot.Exists && Access(token, Read(snapshot).Get("accessTokenHash")), "design-request-not-found", "Không tìm thấy yêu cầu thiết kế.", 404);
            await context.Response.WriteAsJsonAsync(new { request = JsonSafe(Public(id, Read(snapshot))) }); return;
        }
        if (context.Request.Method != "POST") { context.Response.Headers.Allow = "GET, POST"; throw Error("method-not-allowed", "API yêu cầu thiết kế chỉ chấp nhận GET hoặc POST.", 405); }
        var body = await Body(context); var action = body.S("action");
        if (action == "create") { await Create(context, body); return; }
        if (action is "respond" or "admin-update")
        {
            var admin = action == "admin-update";
            if (admin) await Admin(context);
            var id = body.S("id"); var token = body.S("accessToken"); var response = body.S("response"); var status = body.S("status");
            var quoted = body.Get("quotedTotal") == null || body.Get("quotedTotal") is "" ? (double?)null : body.N("quotedTotal"); var note = Clean(body.S("quoteNote"), 1000);
            Require(Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,128}$") && (admin ? Statuses.Contains(status) && note != null && (quoted == null || Safe(quoted.Value) && quoted is >= 0 and <= 1e9) && (status != "Chờ khách xác nhận" || quoted != null) : token.Length > 0 && response is "accept" or "reject"), admin ? "invalid-design-update" : "invalid-design-response", admin ? "Trạng thái, báo giá hoặc ghi chú không hợp lệ." : "Phản hồi báo giá không hợp lệ.");
            var reference = db.Collection("designRequests").Document(id);
            var result = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(reference); var data = Read(snapshot);
                Require(snapshot.Exists && (admin || Access(token, data.Get("accessTokenHash"))), "design-request-not-found", "Không tìm thấy yêu cầu thiết kế.", 404);
                if (!admin) Require(data.S("status") == "Chờ khách xác nhận" && Safe(data.Get("quotedTotal")), "design-quote-unavailable", "Yêu cầu chưa có báo giá cần xác nhận.", 409);
                var nextStatus = admin ? status : response == "accept" ? "Đang thực hiện" : "Đã hủy";
                var detail = admin ? status == "Chờ khách xác nhận" ? $"Cửa hàng gửi báo giá {quoted} ₫{(string.IsNullOrEmpty(note) ? "" : " · " + note)}." : string.IsNullOrEmpty(note) ? $"Cửa hàng cập nhật trạng thái: {status}." : note : response == "accept" ? "Khách đã chấp nhận báo giá." : "Khách đã từ chối báo giá.";
                var history = Arr(data.Get("history")); history.Add(History(nextStatus, detail!));
                var update = Map("status", nextStatus, "history", history, "updatedAt", FieldValue.ServerTimestamp);
                if (admin) { update["quotedTotal"] = quoted ?? data.N("quotedTotal"); update["quoteNote"] = note ?? ""; }
                else update["customerResponse"] = response;
                transaction.Update(reference, update);
                data["status"] = nextStatus;
                if (admin) { data["quotedTotal"] = quoted ?? data.N("quotedTotal"); data["quoteNote"] = note ?? ""; data["updatedAt"] = Iso(Now()); }
                else data["customerResponse"] = response;
                return Public(id, data);
            });
            await context.Response.WriteAsJsonAsync(new { request = JsonSafe(result) }); return;
        }
        throw Error("invalid-design-action", "Thao tác yêu cầu thiết kế không hợp lệ.");
    }
    private static string CanonicalColor(string value)
    {
        var key = value.Trim().ToLowerInvariant();
        return key switch { "white" => "trắng", "black" => "đen", "cream" => "kem", "pink" => "hồng", "red" => "đỏ", "yellow" => "vàng", "orange" => "cam", "green" or "blue" => "xanh", "purple" => "tím", "multicolor" => "nhiều màu", _ => key };
    }
    private async Task Create(HttpContext context, Dictionary<string, object> body)
    {
        var user = await orders.Optional(context); var name = Clean(body.S("customerName"), 100); var phone = Clean(body.S("phone"), 30); var address = Clean(body.S("address"), 500);
        var date = body.S("deliveryDate"); var time = body.S("deliveryTime"); var zoneId = body.S("deliveryZoneId"); var design = Design(Obj(body.Get("design"))); var stems = Stems(body.Get("stems")); var note = Clean(body.S("deliveryNote"), 500); var image = Image(body.Get("referenceImage"));
        Require(!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(phone) && !string.IsNullOrEmpty(address) && stems != null && (stems.Count > 0 || design != null && design.B("surprise") && design.N("budget") > 0) && design != null && note != null && image != null && Regex.IsMatch(zoneId, "^[A-Za-z0-9_-]{1,80}$") && Schedule(date, time).Length == 0, "invalid-design-request", "Thông tin người nhận, lịch giao hoặc thiết kế không hợp lệ.");
        Require(Phone(phone!).Length is >= 8 and <= 15, "invalid-design-request", "Số điện thoại không hợp lệ.");
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_'); var db = firebase.Db; var reference = db.Collection("designRequests").Document();
        var result = await db.RunTransactionAsync(async transaction =>
        {
            var snapshots = new List<DocumentSnapshot>(); foreach (var stem in stems!) snapshots.Add(await transaction.GetSnapshotAsync(db.Collection("products").Document(stem.S("productId"))));
            var delivery = Read(await transaction.GetSnapshotAsync(db.Document("metadata/deliveryZones"))); var wrapping = Read(await transaction.GetSnapshotAsync(db.Document("metadata/bouquetWrapping"))); var zone = Delivery(delivery, zoneId)!;
            var products = new List<Dictionary<string, object>>();
            for (var i = 0; i < stems!.Count; i++)
            {
                var data = Read(snapshots[i]); var stem = stems[i];
                Require(snapshots[i].Exists && data.S("status") != "hidden" && data.S("saleType") == "flower", "product-unavailable", "Một loại hoa không còn khả dụng.", 409);
                var colors = Arr(data.Get("colors")).Select(v => CanonicalColor(Str(v))).ToList();
                Require(colors.Count == 0 || colors.Contains(CanonicalColor(stem.S("color"))), "product-unavailable", $"Màu {stem.S("color")} của hoa {data.S("title", "đã chọn")} hiện không có.", 409);
                Require(Safe(data.N("quantity")) && data.N("quantity") >= stem.N("quantity"), "insufficient-stock", $"Hoa {data.S("title", "đã chọn")} không còn đủ số lượng.", 409);
                var product = new Dictionary<string, object>(stem) { ["title"] = Cut(data.S("title", "Hoa"), 120), ["image"] = Cut(data.S("image"), 1000), ["price"] = Vnd(data.Get("price")), ["priceUpdatedAt"] = data.S("priceUpdatedAt"), ["stock"] = data.N("quantity") }; products.Add(product);
            }
            var tiers = CatalogEndpoints.Tiers(wrapping.Get("tiers")); Require(tiers != null, "bouquet-wrapping-unavailable", "Cửa hàng chưa cấu hình bậc phí bó hoa.", 409);
            var count = products.Sum(p => p.N("quantity")); var fee = count == 0 || design!.S("wrapStyle") == "Không gói" || design.N("paperLayers") == 0 ? 0 : tiers!.First(t => t.N("maxStems") >= count).N("fee"); var subtotal = products.Sum(p => p.N("price") * p.N("quantity"));
            var main = design!.S("mainProductId"); var finalDesign = new Dictionary<string, object>(design) { ["mainProductId"] = main.Length > 0 && products.Any(p => p.S("productId") == main) ? main : products.FirstOrDefault()?.S("productId") ?? "" };
            var request = Map("uid", user?.Uid ?? "", "customerName", name!, "phone", phone!, "address", address!, "deliveryDate", date, "deliveryTime", time, "deliveryZoneId", zone.S("id"), "deliveryProvince", zone.S("province"), "deliveryDistrict", zone.S("district"), "deliveryNote", note!, "stems", products, "design", finalDesign, "referenceImage", image!, "specialRequest", design.S("specialRequest"), "subtotal", subtotal, "wrappingFee", fee, "estimatedTotal", subtotal + fee, "quotedTotal", 0, "quoteNote", "", "status", "Chờ tư vấn", "customerResponse", "", "accessTokenHash", OrderEndpoints.Hash(token), "history", new[] { History("Chờ tư vấn", "Khách đã gửi yêu cầu thiết kế.") }, "createdAt", FieldValue.ServerTimestamp, "updatedAt", FieldValue.ServerTimestamp);
            transaction.Create(reference, request);
            return Map("id", reference.Id, "status", "Chờ tư vấn", "subtotal", subtotal, "wrappingFee", fee, "estimatedTotal", subtotal + fee, "createdAt", Iso(Now()));
        });
        context.Response.StatusCode = 201; await context.Response.WriteAsJsonAsync(new { request = result, accessToken = token });
    }
}
