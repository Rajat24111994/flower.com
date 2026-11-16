using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.Catalog;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.DesignRequests;

/// <summary>Port of backend/design-requests/controller.js. Design requests do not reserve product stock.</summary>
public sealed class DesignRequestsHandler(Func<FirestoreDb> database, IFirebaseAdminBackend auth,
    FirebaseAdminService authentication, ILogger<DesignRequestsHandler> logger)
{
    private static bool ValidId(string id) => Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,128}\z");
    private static string NowIso() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private static Task Error(HttpContext context, int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
    private static Task WriteRequest(HttpContext context, Dictionary<string, object> request) =>
        context.Response.WriteAsJsonAsync(new { request = FirestoreValues.JsonCompatible(request) }, context.RequestAborted);

    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(context, 503, "admin-api-not-configured", "API yêu cầu thiết kế chưa được thiết lập."); return; }
        if (context.Request.Method == "GET")
        {
            if (context.Request.Query["manage"].ToString() == "1")
            {
                if (await authentication.VerifyAdminRequestAsync(context) is null) return;
                try
                {
                    var snapshot = await db.Collection("designRequests").OrderByDescending("createdAt").Limit(100).GetSnapshotAsync(context.RequestAborted);
                    await context.Response.WriteAsJsonAsync(new { requests = snapshot.Documents.Select(document =>
                        FirestoreValues.JsonCompatible(DesignValidation.PublicRequest(document.Id, document.ToDictionary()))).ToList() }, context.RequestAborted);
                }
                catch { logger.LogError("Design request list failed."); await Error(context, 503, "design-request-unavailable", "Chưa thể tải danh sách yêu cầu thiết kế."); }
                return;
            }
            var id = context.Request.Query["id"].ToString(); var token = context.Request.Query["token"].ToString();
            if (!ValidId(id) || token.Length == 0) { await Error(context, 400, "invalid-design-request", "Mã yêu cầu hoặc mã truy cập không hợp lệ."); return; }
            try
            {
                var snapshot = await db.Collection("designRequests").Document(id).GetSnapshotAsync(context.RequestAborted);
                if (!snapshot.Exists || !DesignValidation.ValidAccessToken(Js.Element(token), Js.Element(snapshot.ToDictionary().GetValueOrDefault("accessTokenHash"))))
                { await Error(context, 404, "design-request-not-found", "Không tìm thấy yêu cầu thiết kế."); return; }
                await WriteRequest(context, DesignValidation.PublicRequest(snapshot.Id, snapshot.ToDictionary()));
            }
            catch { logger.LogError("Design request lookup failed."); await Error(context, 503, "design-request-unavailable", "Chưa thể tra cứu yêu cầu thiết kế."); }
            return;
        }
        if (context.Request.Method != "POST")
        { context.Response.Headers.Allow = "GET, POST"; await Error(context, 405, "method-not-allowed", "API yêu cầu thiết kế chỉ chấp nhận GET hoặc POST."); return; }
        var body = await JsonInput.ReadAsync(context); var action = Js.StringOrEmpty(Js.Get(body, "action"));
        switch (action)
        {
            case "create": await CreateAsync(context, db, body); return;
            case "respond": await RespondAsync(context, db, body); return;
            case "admin-update": await AdminUpdateAsync(context, db, body); return;
            default: await Error(context, 400, "invalid-design-action", "Thao tác yêu cầu thiết kế không hợp lệ."); return;
        }
    }

    private async Task CreateAsync(HttpContext context, FirestoreDb db, JsonElement body)
    {
        FirebaseIdentity? user = null;
        var match = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+([^\r\n\u2028\u2029]+)$", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            try { user = await auth.VerifyIdTokenAsync(match.Groups[1].Value, true, context.RequestAborted); }
            catch { await Error(context, 401, "unauthenticated", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."); return; }
        }
        var name = DesignValidation.CleanText(Js.Get(body, "customerName"), 100); var phone = DesignValidation.CleanText(Js.Get(body, "phone"), 30);
        var address = DesignValidation.CleanText(Js.Get(body, "address"), 500);
        var date = Js.StringOrEmpty(Js.Get(body, "deliveryDate")); var time = Js.StringOrEmpty(Js.Get(body, "deliveryTime"));
        var zoneId = Js.StringOrEmpty(Js.Get(body, "deliveryZoneId")); var design = DesignValidation.ParseDesign(Js.Get(body, "design"));
        var stems = DesignValidation.NormalizeStems(Js.Get(body, "stems")); var note = DesignValidation.CleanText(Js.Get(body, "deliveryNote"), DesignValidation.TextLimits["deliveryNote"]);
        var image = DesignValidation.ValidImage(Js.Get(body, "referenceImage"));
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(phone) || string.IsNullOrEmpty(address) || stems is null
            || stems.Count == 0 && !(design?.GetValueOrDefault("surprise") is true && Convert.ToDouble(design.GetValueOrDefault("budget"), CultureInfo.InvariantCulture) > 0)
            || design is null || note is null || image is null || !Regex.IsMatch(zoneId, @"\A[A-Za-z0-9_-]{1,80}\z")
            || OrderValidation.DeliveryScheduleError(date, time).Length > 0)
        { await Error(context, 400, "invalid-design-request", "Thông tin người nhận, lịch giao hoặc thiết kế không hợp lệ."); return; }
        if (OrderValidation.NormalizePhone(phone).Length is < 8 or > 15)
        { await Error(context, 400, "invalid-design-request", "Số điện thoại không hợp lệ."); return; }
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        var reference = db.Collection("designRequests").Document();
        var productRefs = stems.Select(stem => db.Collection("products").Document((string)stem["productId"])).ToList();
        try
        {
            var result = await db.RunTransactionAsync(async transaction =>
            {
                var productsTask = transaction.GetAllSnapshotsAsync(productRefs, context.RequestAborted);
                var zonesTask = transaction.GetSnapshotAsync(db.Collection("metadata").Document("deliveryZones"), context.RequestAborted);
                var wrappingTask = transaction.GetSnapshotAsync(db.Collection("metadata").Document("bouquetWrapping"), context.RequestAborted);
                await Task.WhenAll(productsTask, zonesTask, wrappingTask);
                var productSnapshots = await productsTask; var zonesSnapshot = await zonesTask; var wrappingSnapshot = await wrappingTask;
                var pricing = await WiltingPriceStore.LoadAsync(db, productSnapshots.Select(doc => doc.Id), transaction, context.RequestAborted);
                var (zone, _) = OrderPricing.ResolveDeliveryZone(Js.Element(zonesSnapshot.ToDictionary()), zoneId);
                var products = stems.Select((stem, index) =>
                {
                    var snapshot = productSnapshots[index]; var data = snapshot.Exists ? snapshot.ToDictionary() : new Dictionary<string, object>();
                    if (!snapshot.Exists || data.GetValueOrDefault("status") is "hidden" || OrderPricing.GetProductSaleType(Js.Element(data)) != "flower")
                        throw new BackendException("product-unavailable", "Một loại hoa không còn khả dụng.");
                    var colors = data.GetValueOrDefault("colors") is IEnumerable<object> values ? values.Select(value => DesignValidation.CanonicalColor(Js.Element(value))).ToList() : [];
                    if (colors.Count > 0 && !colors.Contains(DesignValidation.CanonicalColor(Js.Element(stem["color"]))))
                        throw new BackendException("product-unavailable", $"Màu {stem["color"]} của hoa {Js.String(Js.Element(FirestoreValues.Or(data, "title", "đã chọn")))} hiện không có.");
                    var stock = Js.Number(Js.Element(data.GetValueOrDefault("quantity"))); var quantity = Convert.ToDouble(stem["quantity"], CultureInfo.InvariantCulture);
                    if (!Js.SafeInteger(stock) || stock < quantity)
                        throw new BackendException("insufficient-stock", $"Hoa {Js.String(Js.Element(FirestoreValues.Or(data, "title", "đã chọn")))} không còn đủ số lượng.");
                    var line = new Dictionary<string, object>(stem) { ["title"] = Js.Cut(Js.String(Js.Element(FirestoreValues.Or(data, "title", "Hoa"))), 120),
                        ["image"] = Js.Cut(Js.String(Js.Element(FirestoreValues.Or(data, "image"))), 1000), ["price"] = OrderPricing.GetProductPrice(Js.Element(data)),
                        ["priceUpdatedAt"] = Js.String(Js.Element(FirestoreValues.Or(data, "priceUpdatedAt"))), ["stock"] = stock };
                    pricing.ApplyToLine(line, snapshot.Id, data);
                    return line;
                }).ToList();
                var tiers = Js.Get(Js.Element(wrappingSnapshot.ToDictionary()), "tiers");
                if (BouquetWrapping.NormalizeTiers(tiers) is null) throw new BackendException("bouquet-wrapping-unavailable", "Cửa hàng chưa cấu hình bậc phí bó hoa.");
                var stemCount = products.Sum(item => Convert.ToDouble(item["quantity"], CultureInfo.InvariantCulture));
                var wrappingFee = stemCount > 0 ? BouquetWrapping.FeeForDesign(tiers, stemCount, Js.Element(design)) ?? 0 : 0;
                var subtotal = products.Sum(item => Convert.ToDouble(item["price"], CultureInfo.InvariantCulture) * Convert.ToDouble(item["quantity"], CultureInfo.InvariantCulture));
                var mainId = (string)design["mainProductId"];
                if (mainId.Length == 0 || !products.Any(item => item["productId"] as string == mainId)) mainId = products.FirstOrDefault()?.GetValueOrDefault("productId") as string ?? "";
                var savedDesign = new Dictionary<string, object>(design) { ["mainProductId"] = mainId };
                var request = new Dictionary<string, object>
                {
                    ["uid"] = user?.Uid ?? "", ["customerName"] = name, ["phone"] = phone, ["address"] = address,
                    ["deliveryDate"] = date, ["deliveryTime"] = time, ["deliveryZoneId"] = zone!["id"], ["deliveryProvince"] = zone["province"],
                    ["deliveryDistrict"] = zone["district"], ["deliveryNote"] = note, ["stems"] = products, ["design"] = savedDesign,
                    ["referenceImage"] = image, ["specialRequest"] = design.GetValueOrDefault("specialRequest") ?? "", ["subtotal"] = subtotal,
                    ["wrappingFee"] = wrappingFee, ["estimatedTotal"] = subtotal + wrappingFee, ["quotedTotal"] = 0, ["quoteNote"] = "",
                    ["status"] = "Chờ tư vấn", ["customerResponse"] = "", ["accessTokenHash"] = hash,
                    ["history"] = new[] { DesignValidation.AddHistory("Chờ tư vấn", "Khách đã gửi yêu cầu thiết kế.") },
                    ["createdAt"] = FieldValue.ServerTimestamp, ["updatedAt"] = FieldValue.ServerTimestamp
                };
                transaction.CreateJs(reference, request);
                return new { id = reference.Id, status = "Chờ tư vấn", subtotal, wrappingFee, estimatedTotal = subtotal + wrappingFee, createdAt = NowIso() };
            }, cancellationToken: context.RequestAborted);
            context.Response.StatusCode = 201; await context.Response.WriteAsJsonAsync(new { request = result, accessToken = token }, context.RequestAborted);
        }
        catch (BackendException error) when (new[] { "product-unavailable", "insufficient-stock", "delivery-zone-unavailable", "bouquet-wrapping-unavailable" }.Contains(error.Code))
        { await Error(context, 409, error.Code, error.Message); }
        catch { logger.LogError("Design request create failed."); await Error(context, 503, "design-request-unavailable", "Chưa thể lưu yêu cầu thiết kế. Vui lòng thử lại."); }
    }

    private async Task RespondAsync(HttpContext context, FirestoreDb db, JsonElement body)
    {
        var id = Js.StringOrEmpty(Js.Get(body, "id")); var token = Js.StringOrEmpty(Js.Get(body, "accessToken")); var response = Js.StringOrEmpty(Js.Get(body, "response"));
        if (!ValidId(id) || token.Length == 0 || response is not ("accept" or "reject"))
        { await Error(context, 400, "invalid-design-response", "Phản hồi báo giá không hợp lệ."); return; }
        try
        {
            var reference = db.Collection("designRequests").Document(id);
            var request = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted); var data = snapshot.Exists ? snapshot.ToDictionary() : null;
                if (data is null || !DesignValidation.ValidAccessToken(Js.Element(token), Js.Element(data.GetValueOrDefault("accessTokenHash"))))
                    throw new BackendException("design-request-not-found", "Không tìm thấy yêu cầu thiết kế.");
                if (data.GetValueOrDefault("status") is not "Chờ khách xác nhận" || !Js.SafeInteger(Js.Element(data.GetValueOrDefault("quotedTotal"))))
                    throw new BackendException("design-quote-unavailable", "Yêu cầu chưa có báo giá cần xác nhận.");
                var status = response == "accept" ? "Đang thực hiện" : "Đã hủy";
                var history = data.GetValueOrDefault("history") is IEnumerable<object> events ? events.ToList() : [];
                history.Add(DesignValidation.AddHistory(status, response == "accept" ? "Khách đã chấp nhận báo giá." : "Khách đã từ chối báo giá."));
                transaction.UpdateJs(reference, new Dictionary<string, object> { ["status"] = status, ["customerResponse"] = response,
                    ["history"] = history, ["updatedAt"] = FieldValue.ServerTimestamp });
                // Legacy response contains the snapshot history, not the just-appended event.
                return DesignValidation.PublicRequest(snapshot.Id, new Dictionary<string, object>(data) { ["status"] = status, ["customerResponse"] = response });
            }, cancellationToken: context.RequestAborted);
            await WriteRequest(context, request);
        }
        catch (BackendException error) when (error.Code is "design-request-not-found" or "design-quote-unavailable")
        { await Error(context, error.Code == "design-request-not-found" ? 404 : 409, error.Code, error.Message); }
        catch { logger.LogError("Design request response failed."); await Error(context, 503, "design-request-unavailable", "Chưa thể cập nhật phản hồi. Vui lòng thử lại."); }
    }

    private async Task AdminUpdateAsync(HttpContext context, FirestoreDb db, JsonElement body)
    {
        if (await authentication.VerifyAdminRequestAsync(context) is null) return;
        var id = Js.StringOrEmpty(Js.Get(body, "id")); var status = Js.StringOrEmpty(Js.Get(body, "status")); var rawQuote = Js.Get(body, "quotedTotal");
        double? quote = rawQuote.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null || rawQuote.ValueKind == JsonValueKind.String && rawQuote.GetString() == "" ? null : Js.Number(rawQuote);
        var note = DesignValidation.CleanText(Js.Get(body, "quoteNote"), DesignValidation.TextLimits["quoteNote"]);
        if (!ValidId(id) || !DesignValidation.Statuses.Contains(status) || note is null || quote is not null && (!Js.SafeInteger(quote.Value) || quote is < 0 or > 1_000_000_000)
            || status == "Chờ khách xác nhận" && quote is null)
        { await Error(context, 400, "invalid-design-update", "Trạng thái, báo giá hoặc ghi chú không hợp lệ."); return; }
        try
        {
            var reference = db.Collection("designRequests").Document(id);
            var request = await db.RunTransactionAsync(async transaction =>
            {
                var snapshot = await transaction.GetSnapshotAsync(reference, context.RequestAborted);
                if (!snapshot.Exists) throw new BackendException("design-request-not-found", "Không tìm thấy yêu cầu thiết kế.");
                var data = snapshot.ToDictionary(); var history = data.GetValueOrDefault("history") is IEnumerable<object> events ? events.ToList() : [];
                var detail = status == "Chờ khách xác nhận" ? $"Cửa hàng gửi báo giá {Js.String(Js.Element(quote))} ₫{(note.Length > 0 ? " · " + note : "")}."
                    : note.Length > 0 ? note : $"Cửa hàng cập nhật trạng thái: {status}.";
                history.Add(DesignValidation.AddHistory(status, detail)); var price = quote is null ? data.GetValueOrDefault("quotedTotal") ?? 0 : (object)quote.Value;
                transaction.UpdateJs(reference, new Dictionary<string, object> { ["status"] = status, ["quotedTotal"] = price, ["quoteNote"] = note,
                    ["history"] = history, ["updatedAt"] = FieldValue.ServerTimestamp });
                return DesignValidation.PublicRequest(snapshot.Id, new Dictionary<string, object>(data)
                    { ["status"] = status, ["quotedTotal"] = price, ["quoteNote"] = note, ["updatedAt"] = NowIso() });
            }, cancellationToken: context.RequestAborted);
            await WriteRequest(context, request);
        }
        catch (BackendException error) when (error.Code == "design-request-not-found") { await Error(context, 404, error.Code, error.Message); }
        catch { logger.LogError("Design request admin update failed."); await Error(context, 503, "design-request-unavailable", "Chưa thể cập nhật yêu cầu thiết kế."); }
    }
}
