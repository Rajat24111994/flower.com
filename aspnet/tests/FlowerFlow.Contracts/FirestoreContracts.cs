using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Grpc.Core;
using FlowerFlow.Infrastructure.Accounts;
using FlowerFlow.Infrastructure.Catalog;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using FlowerFlow.Infrastructure.Admin;
using FlowerFlow.Infrastructure.ShopSettings;
using FlowerFlow.Infrastructure.Orders;
using FlowerFlow.Infrastructure.Http;
using FlowerFlow.Infrastructure.DesignRequests;

static class FirestoreContracts
{
    public static async Task RunAsync()
    {
        // Explicit local endpoint and fixed demo project: never uses ADC or a production database.
        var db = new FirestoreDbBuilder
        {
            ProjectId = "demo-flowerflow-csharp", Endpoint = "127.0.0.1:8787",
            ChannelCredentials = ChannelCredentials.Insecure
        }.Build();
        var actor = new FirebaseIdentity("audit-tester", new Dictionary<string, object> { ["email"] = "tester@example.invalid" });
        var details = new Dictionary<string, object> { ["before"] = 1, ["after"] = 2 };
        var separate = await AdminAudit.RecordAdminAuditAsync(db, actor, "test.separate", "test", "item", details);
        var entry = await separate.GetSnapshotAsync();
        AdditionalContracts.Require(entry.GetValue<Timestamp>("createdAt").ToDateTime() > DateTime.UnixEpoch
            && entry.GetValue<string>("actorUid") == actor.Uid, "Audit server timestamp/actor not persisted");
        var item = db.Collection("contractTestItems").Document();
        DocumentReference? audit = null;
        await db.RunTransactionAsync(transaction =>
        {
            transaction.Create(item, new { quantity = 2 });
            audit = AdminAudit.AddAdminAudit(transaction, db, actor, "test.atomic", "test", item.Id, details);
            return Task.FromResult(0);
        });
        AdditionalContracts.Require((await item.GetSnapshotAsync()).Exists && (await audit!.GetSnapshotAsync()).Exists,
            "Audit and business write did not commit together");
        var rejectedItem = db.Collection("contractTestItems").Document();
        DocumentReference? rejectedAudit = null;
        try
        {
            await db.RunTransactionAsync<int>(transaction =>
            {
                transaction.Create(rejectedItem, new { quantity = 3 });
                rejectedAudit = AdminAudit.AddAdminAudit(transaction, db, actor, "test.rollback", "test", rejectedItem.Id);
                throw new InvalidOperationException("deliberate-rollback");
            });
            throw new Exception("Expected rollback");
        }
        catch (InvalidOperationException error) when (error.Message == "deliberate-rollback") { }
        AdditionalContracts.Require(!(await rejectedItem.GetSnapshotAsync()).Exists
            && !(await rejectedAudit!.GetSnapshotAsync()).Exists, "Rolled-back audit leaked into database");
        Console.WriteLine("PASS: local Firestore Emulator audit writes, server timestamp, atomic commit and rollback.");
        var suffix = Guid.NewGuid().ToString("N");
        var owner = new RoleUser("owner-" + suffix, "owner@example.invalid", new Dictionary<string, object> { ["admin"] = true, ["role"] = "owner" });
        var admin = new RoleUser("admin-" + suffix, null, new Dictionary<string, object> { ["admin"] = true });
        var removed = new RoleUser("removed-" + suffix, null, new Dictionary<string, object> { ["admin"] = "true" });
        var ownerRef = db.Collection("adminRoles").Document(owner.Uid);
        await ownerRef.SetAsync(new Dictionary<string, object> { ["customField"] = 7 });
        await AdminRoles.SyncAdminRoleAsync(db, owner);
        var ownerDoc = await ownerRef.GetSnapshotAsync();
        AdditionalContracts.Require(ownerDoc.GetValue<string>("role") == "owner" && ownerDoc.GetValue<long>("customField") == 7,
            "Role sync must merge and preserve owner");
        await db.Collection("adminRoles").Document(removed.Uid).SetAsync(new { role = "admin" });
        var users = new[] { owner, admin, removed };
        AdditionalContracts.Require(await AdminRoles.SyncAdminRolesAsync(db, users) == 2, "Backfill write count changed");
        AdditionalContracts.Require(await AdminRoles.SyncAdminRolesAsync(db, users) == 0, "Backfill must be idempotent");
        AdditionalContracts.Require(!(await db.Collection("adminRoles").Document(removed.Uid).GetSnapshotAsync()).Exists,
            "Non-boolean admin claim must remove role document");
        await AdminRoles.SyncAdminRoleAsync(db, owner, false);
        AdditionalContracts.Require(!(await ownerRef.GetSnapshotAsync()).Exists, "Explicit role removal failed");
        Console.WriteLine("PASS: Firestore role merge, owner preservation, batch backfill, idempotency and revocation.");
        long now = 1_700_000_000_000;
        var protection = new LoginProtection(db, () => now);
        var accountKey = "login-" + suffix;
        for (var failures = 1; failures <= 10; failures++)
        {
            var attempt = await protection.AcquireAsync(accountKey, 1);
            AdditionalContracts.Require(attempt.Code is null, "Login unexpectedly blocked after expiry");
            var competing = await protection.AcquireAsync(accountKey, 2);
            AdditionalContracts.Require(competing.Code == "login-in-progress", "Password version must not bypass active lease");
            var result = await protection.FinishAsync(attempt, "invalid");
            if (failures < 5) AdditionalContracts.Require(result.Code == "invalid-credential", "Initial attempt policy changed");
            else if (failures < 10)
            {
                var minutes = LoginProtection.LockMinutes[failures - 5];
                AdditionalContracts.Require(result.Code == "account-locked" && result.RetryAfter == minutes * 60, "Escalating lock changed");
                AdditionalContracts.Require((await protection.AcquireAsync(accountKey, 1)).Code == "account-locked", "Lock bypassed");
                now += minutes * 60_000L;
            }
            else AdditionalContracts.Require(result.Code == "password-reset-required", "Reset requirement missing");
        }
        AdditionalContracts.Require((await protection.AcquireAsync(accountKey, 1)).Code == "password-reset-required", "Reset requirement bypassed");
        var afterReset = await protection.AcquireAsync(accountKey, 2);
        AdditionalContracts.Require(afterReset.Code is null, "Server password version must reset lock");
        AdditionalContracts.Require((await protection.FinishAsync(afterReset, "success")).Status == 200, "Valid login failed");
        AdditionalContracts.Require(!(await afterReset.Ref!.GetSnapshotAsync()).Exists, "Successful login did not clear protection record");
        var unavailable = await protection.AcquireAsync(accountKey, 2);
        await protection.FinishAsync(unavailable, "unavailable");
        AdditionalContracts.Require(Convert.ToDouble((await unavailable.Ref!.GetSnapshotAsync()).GetValue<object>("failures")) == 0,
            "Provider outage must not count as password failure");
        var expired = await protection.AcquireAsync(accountKey, 2);
        now += LoginProtection.LeaseMs;
        AdditionalContracts.Require((await protection.FinishAsync(expired, "success")).Status == 503, "Expired lease accepted");
        var concurrentKey = "concurrent-" + suffix;
        var concurrent = await Task.WhenAll(protection.AcquireAsync(concurrentKey, 1), protection.AcquireAsync(concurrentKey, 1));
        AdditionalContracts.Require(concurrent.Count(result => result.Code is null) == 1
            && concurrent.Count(result => result.Code == "login-in-progress") == 1, "Concurrent login lease not serialized");
        Console.WriteLine("PASS: Firestore login leases, concurrent requests, escalating locks, reset version and provider outages.");
        var reviewId = Guid.NewGuid().ToString("N") + "00000000";
        var photoId = reviewId + "_0";
        var reviewRef = db.Collection("reviews").Document(reviewId);
        var bytes = new byte[] { 0xff, 0xd8, 0xff, 0xd9 };
        await reviewRef.SetAsync(new { authorUid = "user-a", moderationStatus = "pending", photoIds = new[] { photoId } });
        await db.Collection("reviewImages").Document(photoId).SetAsync(new { reviewId, bytes });
        using var identityCase = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\"}}");
        var imageHandler = new ReviewImagesHandler(() => db, new FakeBackend(identityCase.RootElement), NullLogger<ReviewImagesHandler>.Instance);
        static DefaultHttpContext ImageContext(string photo, string? bearer = null)
        {
            var context = new DefaultHttpContext(); context.Request.Method = "GET";
            context.Request.QueryString = new QueryString("?id=" + photo); context.Response.Body = new MemoryStream();
            if (bearer is not null) context.Request.Headers.Authorization = bearer;
            return context;
        }
        var hiddenPhoto = ImageContext(photoId); await imageHandler.HandleAsync(hiddenPhoto);
        AdditionalContracts.Require(hiddenPhoto.Response.StatusCode == 404, "Pending review image exposed to guest");
        var ownPhoto = ImageContext(photoId, "Bearer token"); await imageHandler.HandleAsync(ownPhoto);
        AdditionalContracts.Require(ownPhoto.Response.StatusCode == 200
            && ((MemoryStream)ownPhoto.Response.Body).ToArray().SequenceEqual(bytes), "Author cannot view own image");
        await reviewRef.UpdateAsync(new Dictionary<string, object> { ["moderationStatus"] = "approved" });
        var approvedPhoto = ImageContext(photoId); await imageHandler.HandleAsync(approvedPhoto);
        AdditionalContracts.Require(approvedPhoto.Response.StatusCode == 200 && approvedPhoto.Response.ContentType == "image/jpeg"
            && approvedPhoto.Response.Headers.CacheControl == "private, no-store" && approvedPhoto.Response.Headers.XContentTypeOptions == "nosniff",
            "Approved image response differs");
        await db.Collection("reviewImages").Document(photoId).UpdateAsync(new Dictionary<string, object> { ["reviewId"] = "other-review" });
        var unrelated = ImageContext(photoId); await imageHandler.HandleAsync(unrelated);
        AdditionalContracts.Require(unrelated.Response.StatusCode == 404, "Unrelated photo exposed");
        Console.WriteLine("PASS: review image author/guest visibility, original bytes, response headers and review ownership.");
        using var adminCase = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\",\"admin\":true}}");
        var photoAuth = new FirebaseAdminService(new FakeBackend(adminCase.RootElement), NullLogger<FirebaseAdminService>.Instance);
        var productsHandler = new ProductImagesHandler(() => db, photoAuth, NullLogger<ProductImagesHandler>.Instance);
        var jpeg = await File.ReadAllBytesAsync(Path.Combine(Directory.GetCurrentDirectory(), "flower.com/images/start.jpeg"));
        var jpegId = Convert.ToHexStringLower(SHA1.HashData(jpeg));
        var adminRef = db.Collection("adminRoles").Document("user-a");
        await adminRef.DeleteAsync();
        DefaultHttpContext UploadContext(string? photo)
        {
            var context = new DefaultHttpContext(); context.Request.Method = "POST";
            context.Request.Headers.Authorization = "Bearer token";
            var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { photo }));
            context.Request.Body = new MemoryStream(payload); context.Request.ContentLength = payload.Length;
            context.Response.Body = new MemoryStream(); return context;
        }
        var noRole = UploadContext("data:image/jpeg;base64," + Convert.ToBase64String(jpeg));
        await productsHandler.HandleAsync(noRole);
        AdditionalContracts.Require(noRole.Response.StatusCode == 403, "Claim without role uploaded image");
        await adminRef.SetAsync(new { role = "admin" });
        foreach (var iteration in new[] { 1, 2 })
        {
            var upload = UploadContext("data:image/jpeg;base64," + Convert.ToBase64String(jpeg));
            await productsHandler.HandleAsync(upload);
            AdditionalContracts.Require(upload.Response.StatusCode == 201
                && Encoding.UTF8.GetString(((MemoryStream)upload.Response.Body).ToArray()).Contains(jpegId), "Photo upload/dedup failed");
        }
        var download = ImageContext(jpegId); await productsHandler.HandleAsync(download);
        AdditionalContracts.Require(download.Response.StatusCode == 200
            && ((MemoryStream)download.Response.Body).ToArray().SequenceEqual(jpeg)
            && download.Response.Headers.CacheControl == "public, max-age=31536000, immutable", "Product image bytes/cache changed");
        var invalidUpload = UploadContext("data:image/jpeg;base64,dGV4dA=="); await productsHandler.HandleAsync(invalidUpload);
        AdditionalContracts.Require(invalidUpload.Response.StatusCode == 400, "Invalid image uploaded");
        await adminRef.DeleteAsync();
        Console.WriteLine("PASS: product image live role, JPEG validation, SHA-1 deduplication, original bytes and immutable cache.");
        using var auditCase = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\",\"admin\":true},\"roleExists\":true}");
        var auditAuth = new FirebaseAdminService(new FakeBackend(auditCase.RootElement), NullLogger<FirebaseAdminService>.Instance);
        var auditHandler = new AdminAuditHandler(() => db, auditAuth, NullLogger<AdminAuditHandler>.Instance);
        var auditContext = ImageContext(""); auditContext.Request.Headers.Authorization = "Bearer token";
        await auditHandler.HandleAsync(auditContext);
        using var auditBody = JsonDocument.Parse(((MemoryStream)auditContext.Response.Body).ToArray());
        var auditEntries = auditBody.RootElement.GetProperty("entries").EnumerateArray().ToArray();
        AdditionalContracts.Require(auditContext.Response.StatusCode == 200 && auditEntries.Length <= 100
            && auditEntries.Any(item => item.GetProperty("id").GetString() == separate.Id)
            && auditEntries.All(item => item.EnumerateObject().Count() == 8), "Audit listing shape/limit changed");
        var noAuditToken = ImageContext(""); await auditHandler.HandleAsync(noAuditToken);
        AdditionalContracts.Require(noAuditToken.Response.StatusCode == 401, "Audit listing exposed without authentication");
        Console.WriteLine("PASS: admin audit listing fields, timestamp serialization, limit and unauthenticated access rejection.");
        var wrapping = new BouquetWrappingHandler(() => db, auditAuth, NullLogger<BouquetWrappingHandler>.Instance);
        var wrappingRef = db.Collection("metadata").Document("bouquetWrapping");
        await wrappingRef.DeleteAsync();
        var unconfigured = ImageContext(""); await wrapping.HandleAsync(unconfigured);
        using var emptyWrapping = JsonDocument.Parse(((MemoryStream)unconfigured.Response.Body).ToArray());
        AdditionalContracts.Require(!emptyWrapping.RootElement.GetProperty("configured").GetBoolean(), "Missing wrapping config must stay unconfigured");
        DefaultHttpContext JsonContext(string json, string method = "POST")
        {
            var context = new DefaultHttpContext(); context.Request.Method = method;
            context.Request.Headers.Authorization = "Bearer token";
            var payload = Encoding.UTF8.GetBytes(json); context.Request.Body = new MemoryStream(payload);
            context.Request.ContentLength = payload.Length; context.Response.Body = new MemoryStream(); return context;
        }
        var invalidTiers = JsonContext("{\"tiers\":[{\"maxStems\":10,\"fee\":1000}]}");
        await wrapping.HandleAsync(invalidTiers);
        AdditionalContracts.Require(invalidTiers.Response.StatusCode == 400 && !(await wrappingRef.GetSnapshotAsync()).Exists,
            "Incomplete wrapping tiers were saved");
        var saveTiers = JsonContext("{\"tiers\":[{\"maxStems\":10,\"fee\":5000},{\"maxStems\":50,\"fee\":15000}]}");
        await wrapping.HandleAsync(saveTiers);
        AdditionalContracts.Require(saveTiers.Response.StatusCode == 200 && (await wrappingRef.GetSnapshotAsync()).Exists,
            "Valid wrapping tiers not saved");
        var wrappingAudits = await db.Collection("adminAudit").WhereEqualTo("action", "bouquet-wrapping.update").GetSnapshotAsync();
        AdditionalContracts.Require(wrappingAudits.Count > 0, "Wrapping update missing audit");
        Console.WriteLine("PASS: wrapping configuration absent/default, tier validation, save and atomic audit.");
        var delivery = new DeliveryZonesHandler(() => db, auditAuth, wrapping, NullLogger<DeliveryZonesHandler>.Instance);
        await db.Collection("metadata").Document("deliveryZones").DeleteAsync();
        var upsertZone = JsonContext("{\"action\":\"upsert\",\"zone\":{\"id\":\"zone-a\",\"province\":\"Hà Nội\",\"district\":\"Ba Đình\",\"fee\":25000,\"enabled\":true}}");
        await delivery.HandleAsync(upsertZone); AdditionalContracts.Require(upsertZone.Response.StatusCode == 200, "Zone upsert failed");
        var duplicateZone = JsonContext("{\"action\":\"upsert\",\"zone\":{\"id\":\"zone-b\",\"province\":\"HÀ NỘI\",\"district\":\"BA ĐÌNH\",\"fee\":0,\"enabled\":true}}");
        await delivery.HandleAsync(duplicateZone); AdditionalContracts.Require(duplicateZone.Response.StatusCode == 409, "Duplicate area accepted");
        var disabledZone = JsonContext("{\"action\":\"upsert\",\"zone\":{\"id\":\"zone-c\",\"province\":\"Hà Nội\",\"district\":\"Tây Hồ\",\"fee\":0,\"enabled\":false}}");
        await delivery.HandleAsync(disabledZone);
        var publicZones = ImageContext(""); await delivery.HandleAsync(publicZones);
        using var publicZoneBody = JsonDocument.Parse(((MemoryStream)publicZones.Response.Body).ToArray());
        AdditionalContracts.Require(publicZoneBody.RootElement.GetProperty("zones").GetArrayLength() == 1, "Disabled zone exposed");
        var allZones = ImageContext(""); allZones.Request.QueryString = new QueryString("?manage=1"); allZones.Request.Headers.Authorization = "Bearer token";
        await delivery.HandleAsync(allZones);
        using var manageZoneBody = JsonDocument.Parse(((MemoryStream)allZones.Response.Body).ToArray());
        AdditionalContracts.Require(manageZoneBody.RootElement.GetProperty("zones").GetArrayLength() == 2, "Management zones omitted disabled area");
        var alias = ImageContext(""); alias.Request.QueryString = new QueryString("?route=bouquet-wrapping");
        await delivery.HandleAsync(alias); AdditionalContracts.Require(alias.Response.StatusCode == 200, "Wrapping query alias broken");
        var deleteZone = JsonContext("{\"action\":\"delete\",\"id\":\"zone-a\"}"); await delivery.HandleAsync(deleteZone);
        using var deletedZoneBody = JsonDocument.Parse(((MemoryStream)deleteZone.Response.Body).ToArray());
        AdditionalContracts.Require(!deletedZoneBody.RootElement.GetProperty("configured").GetBoolean(), "Deleting enabled area kept configured=true");
        Console.WriteLine("PASS: delivery zone upsert/delete, case-insensitive duplicate rejection, public/manage visibility and legacy route alias.");
        var reservations = new Reservations(NullLogger<Reservations>.Instance);
        var stockRef = db.Collection("products").Document("hold-stock-" + suffix);
        await stockRef.SetAsync(new { quantity = 10 });
        var expireNow = Timestamp.FromDateTime(DateTime.UtcNow);
        var expiredAt = Timestamp.FromDateTime(DateTime.UtcNow.AddMinutes(-5));
        var hold = db.Collection("orders").Document();
        await hold.SetAsync(new Dictionary<string, object>
        {
            ["status"] = "Chờ xác nhận", ["inventoryReserved"] = true, ["reservationExpiresAt"] = expiredAt, ["paymentMethod"] = "qr",
            ["items"] = new[] { new { id = stockRef.Id, quantity = 2 }, new { id = stockRef.Id, quantity = 3 } }
        });
        var expiryResults = await Task.WhenAll(reservations.ExpireOneReservationAsync(db, hold, expireNow), reservations.ExpireOneReservationAsync(db, hold, expireNow));
        AdditionalContracts.Require(expiryResults.Count(result => result) == 1 && (await stockRef.GetSnapshotAsync()).GetValue<double>("quantity") == 15,
            "Concurrent expiry restored stock more than once");
        var expiredOrder = await hold.GetSnapshotAsync();
        AdditionalContracts.Require(expiredOrder.GetValue<string>("status") == "Đã hủy"
            && expiredOrder.GetValue<string>("paymentStatus") == "Hết hạn chờ thanh toán", "Expired QR status changed");
        foreach (var state in new[] { (Status: "Đang chuẩn bị", Paid: false), (Status: "Chờ xác nhận", Paid: true) })
        {
            var preserved = db.Collection("orders").Document();
            await preserved.SetAsync(new { status = state.Status, paymentVerified = state.Paid, inventoryReserved = true, reservationExpiresAt = expiredAt });
            AdditionalContracts.Require(!await reservations.ExpireOneReservationAsync(db, preserved, expireNow), "Confirmed/paid order expired");
            var retained = await preserved.GetSnapshotAsync();
            AdditionalContracts.Require(retained.GetValue<bool>("inventoryReserved") && !retained.ContainsField("reservationExpiresAt"),
                "Confirmed/paid hold timer not removed");
        }
        var txnRef = db.Collection("paymentTransactions").Document(); await txnRef.SetAsync(new { status = "pending" });
        var vnpHold = db.Collection("orders").Document();
        await vnpHold.SetAsync(new { status = "Chờ xác nhận", paymentMethod = "vnpay", inventoryReserved = true,
            reservationExpiresAt = expiredAt, vnpTxnRef = txnRef.Id, items = Array.Empty<object>() });
        AdditionalContracts.Require(await reservations.ExpireReservationsAsync(db) >= 1
            && (await txnRef.GetSnapshotAsync()).GetValue<string>("status") == "expired", "VNPay reservation/attempt cleanup failed");
        Console.WriteLine("PASS: reservation expiry, concurrent restore-once, duplicate lines, confirmed/paid holds and VNPay attempt expiry.");
        var previousSecret = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");
        try
        {
            Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", "isolated-tracking-test-secret");
            var tracking = new OrderTracking(() => db, new RequestIdentity(new FakeBackend(identityCase.RootElement)), NullLogger<OrderTracking>.Instance);
            var limitContext = ImageContext(""); limitContext.Request.Headers["x-forwarded-for"] = "rate-" + suffix;
            for (var attemptNumber = 0; attemptNumber < 20; attemptNumber++)
                AdditionalContracts.Require((await tracking.CheckOrderLookupLimitAsync(db, limitContext)).Allowed, "Lookup quota ended too early");
            var rejected = await tracking.CheckOrderLookupLimitAsync(db, limitContext);
            AdditionalContracts.Require(!rejected.Allowed && rejected.RetryAfter is > 0 and <= 600, "Lookup quota not enforced");
            var trackedOrder = db.Collection("orders").Document();
            await trackedOrder.SetAsync(new { uid = "user-a", phone = "0901234567", address = "Private address", customerName = "Private name",
                status = "Chờ xác nhận", paymentMethod = "qr", total = 100000, paymentReference = "FF123", createdAt = expireNow });
            var guestLookup = JsonContext(JsonSerializer.Serialize(new { id = trackedOrder.Id, phone = "0901234567" }));
            guestLookup.Request.Headers.Remove("Authorization"); guestLookup.Request.Headers["x-forwarded-for"] = "lookup-" + suffix;
            await tracking.LookupOrderAsync(guestLookup);
            using var guestBody = JsonDocument.Parse(((MemoryStream)guestLookup.Response.Body).ToArray());
            AdditionalContracts.Require(guestLookup.Response.StatusCode == 200
                && guestBody.RootElement.GetProperty("order").GetProperty("privacyLimited").GetBoolean()
                && !guestBody.RootElement.GetProperty("order").TryGetProperty("address", out _), "Guest lookup leaked private fields");
            var ownerLookup = JsonContext(JsonSerializer.Serialize(new { id = trackedOrder.Id })); ownerLookup.Request.Headers["x-forwarded-for"] = "owner-" + suffix;
            await tracking.LookupOrderAsync(ownerLookup);
            using var ownerBody = JsonDocument.Parse(((MemoryStream)ownerLookup.Response.Body).ToArray());
            AdditionalContracts.Require(ownerLookup.Response.StatusCode == 200
                && ownerBody.RootElement.GetProperty("order").GetProperty("address").GetString() == "Private address", "Account owner lookup failed");
            var stranger = JsonContext(JsonSerializer.Serialize(new { id = trackedOrder.Id })); stranger.Request.Headers["x-forwarded-for"] = "stranger-" + suffix;
            stranger.Request.Headers.Remove("Authorization"); RequestIdentity.SetLocalIdentity(stranger, new FirebaseIdentity("other", new Dictionary<string, object>()), true);
            await tracking.LookupOrderAsync(stranger); AdditionalContracts.Require(stranger.Response.StatusCode == 404, "Another account saw the order");
            Console.WriteLine("PASS: lookup quota, guest privacy, account ownership and cross-account rejection on Firestore Emulator.");
        }
        finally { Environment.SetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON", previousSecret); }
        using var ownerCase = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\",\"admin\":true,\"role\":\"owner\",\"email\":\"owner@example.invalid\"}}");
        var ownerAuth = new FirebaseAdminService(new FakeBackend(ownerCase.RootElement), NullLogger<FirebaseAdminService>.Instance);
        var priceHandler = new FlowerPricesHandler(() => db, ownerAuth, NullLogger<FlowerPricesHandler>.Instance);
        await adminRef.SetAsync(new { role = "owner" });
        var flowerRef = db.Collection("products").Document("flower-price-" + suffix);
        await flowerRef.SetAsync(new { saleType = "flower", title = "Hoa hồng", price = 10000, image = "rose.jpg" });
        var priceUpdate = JsonContext(JsonSerializer.Serialize(new { flowerId = flowerRef.Id, price = 12000 }), "PATCH");
        await priceHandler.HandleAsync(priceUpdate);
        AdditionalContracts.Require(priceUpdate.Response.StatusCode == 200 && (await flowerRef.GetSnapshotAsync()).GetValue<double>("price") == 12000,
            "Owner flower price update failed");
        var priceHistory = await db.Collection("priceHistory").WhereEqualTo("flowerId", flowerRef.Id).GetSnapshotAsync();
        AdditionalContracts.Require(priceHistory.Count == 1 && priceHistory.Documents[0].GetValue<double>("oldPrice") == 10000
            && priceHistory.Documents[0].GetValue<double>("newPrice") == 12000, "Price history changed");
        var noChange = JsonContext(JsonSerializer.Serialize(new { flowerId = flowerRef.Id, price = 12000 }), "PATCH");
        await priceHandler.HandleAsync(noChange);
        AdditionalContracts.Require((await db.Collection("priceHistory").WhereEqualTo("flowerId", flowerRef.Id).GetSnapshotAsync()).Count == 1,
            "Unchanged price wrote history");
        await adminRef.SetAsync(new { role = "admin" });
        var revokedOwner = JsonContext(JsonSerializer.Serialize(new { flowerId = flowerRef.Id, price = 13000 }), "PATCH");
        await priceHandler.HandleAsync(revokedOwner); AdditionalContracts.Require(revokedOwner.Response.StatusCode == 403, "Stale owner claim changed price");
        await adminRef.DeleteAsync();
        Console.WriteLine("PASS: owner-only flower pricing, transactional history, unchanged-price no-op and live owner revocation.");
        var catalog = new ProductCatalog(Path.Combine(Directory.GetCurrentDirectory(), "flower.com/flower.json"));
        var productHandler = new ProductsHandler(() => db, photoAuth, catalog, priceHandler, NullLogger<ProductsHandler>.Instance);
        var catalogId = catalog.ById.Keys.First();
        var repaired = productHandler.SerializeProduct(catalogId, new Dictionary<string, object>
        { ["title"] = "???", ["image"] = "/images/flower-01.webp", ["images"] = new object[] { "/images/flower-02.webp", "/custom.jpg" }, ["createdAt"] = expireNow });
        AdditionalContracts.Require(Equals(repaired["title"], catalog.ById[catalogId]["title"])
            && ((List<object>)repaired["images"]).SequenceEqual(new object[] { "/custom.jpg" })
            && repaired["createdAt"] is string, "Legacy product repair/timestamp changed");
        var hiddenId = "hidden-" + suffix; var archivedId = "archived-" + suffix;
        await db.Collection("products").Document(hiddenId).SetAsync(new { title = "Hidden", status = "hidden" });
        await db.Collection("products").Document(archivedId).SetAsync(new { title = "Archived", status = "archived" });
        var publicProducts = ImageContext(""); await productHandler.HandleAsync(publicProducts);
        using var productBody = JsonDocument.Parse(((MemoryStream)publicProducts.Response.Body).ToArray());
        var productIds = productBody.RootElement.GetProperty("products").EnumerateArray().Select(item => item.GetProperty("id").ToString()).ToArray();
        AdditionalContracts.Require(!productIds.Contains(hiddenId) && productIds.Contains(archivedId), "Public catalog filtering changed");
        await adminRef.SetAsync(new { role = "admin" });
        var manageProducts = ImageContext(""); manageProducts.Request.QueryString = new QueryString("?manage=1"); manageProducts.Request.Headers.Authorization = "Bearer token";
        await productHandler.HandleAsync(manageProducts);
        using var manageProductsBody = JsonDocument.Parse(((MemoryStream)manageProducts.Response.Body).ToArray());
        AdditionalContracts.Require(manageProductsBody.RootElement.GetProperty("products").EnumerateArray().Any(item => item.GetProperty("id").ToString() == hiddenId),
            "Manage catalog missing hidden product");
        await adminRef.DeleteAsync();
        Console.WriteLine("PASS: product catalog field preservation, legacy title/image repairs, public/manage visibility and timestamp conversion.");
        var designHandler = new DesignRequestsHandler(() => db, new FakeBackend(identityCase.RootElement), auditAuth, NullLogger<DesignRequestsHandler>.Instance);
        await db.Collection("metadata").Document("deliveryZones").SetAsync(new { zones = new[] { new { id = "design-zone", province = "Hà Nội", district = "Ba Đình", fee = 25000, enabled = true } } });
        await flowerRef.UpdateAsync(new Dictionary<string, object> { ["quantity"] = 10, ["colors"] = new[] { "red", "pink" } });
        var designCreate = JsonContext(JsonSerializer.Serialize(new { action = "create", customerName = "Khách thiết kế", phone = "0901234567", address = "Địa chỉ",
            deliveryDate = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)).Date.AddDays(1).ToString("yyyy-MM-dd"), deliveryTime = "08:00–11:00", deliveryZoneId = "design-zone",
            design = new { wrapStyle = "Không gói" }, stems = new[] { new { productId = flowerRef.Id, quantity = 2, color = "đỏ", role = "main" } } }));
        designCreate.Request.Headers.Remove("Authorization"); await designHandler.HandleAsync(designCreate);
        using var designCreated = JsonDocument.Parse(((MemoryStream)designCreate.Response.Body).ToArray());
        AdditionalContracts.Require(designCreate.Response.StatusCode == 201, "Design request creation failed: " + designCreated.RootElement);
        var designId = designCreated.RootElement.GetProperty("request").GetProperty("id").GetString()!;
        var designToken = designCreated.RootElement.GetProperty("accessToken").GetString()!;
        AdditionalContracts.Require(designCreated.RootElement.GetProperty("request").GetProperty("estimatedTotal").GetDouble() == 24000
            && (await flowerRef.GetSnapshotAsync()).GetValue<double>("quantity") == 10, "Design estimate or non-reservation behavior changed");
        var designLookup = ImageContext(""); designLookup.Request.QueryString = new QueryString("?id=" + designId + "&token=" + designToken);
        await designHandler.HandleAsync(designLookup);
        using var designLookedUp = JsonDocument.Parse(((MemoryStream)designLookup.Response.Body).ToArray());
        AdditionalContracts.Require(designLookup.Response.StatusCode == 200
            && !designLookedUp.RootElement.GetProperty("request").TryGetProperty("accessTokenHash", out _), "Design token hash exposed");
        var designQuote = JsonContext(JsonSerializer.Serialize(new { action = "admin-update", id = designId, status = "Chờ khách xác nhận", quotedTotal = 50000, quoteNote = "Bó đỏ" }));
        await designHandler.HandleAsync(designQuote); AdditionalContracts.Require(designQuote.Response.StatusCode == 200, "Admin design quote failed");
        var designAccept = JsonContext(JsonSerializer.Serialize(new { action = "respond", id = designId, accessToken = designToken, response = "accept" }));
        await designHandler.HandleAsync(designAccept); AdditionalContracts.Require(designAccept.Response.StatusCode == 200, "Design quote acceptance failed");
        AdditionalContracts.Require((await db.Collection("designRequests").Document(designId).GetSnapshotAsync()).GetValue<string>("status") == "Đang thực hiện",
            "Design quote acceptance not persisted");
        Console.WriteLine("PASS: design creation/estimate without stock reservation, secret-token lookup, admin quote and customer acceptance.");
        var reviewTracking = new OrderTracking(() => db, new RequestIdentity(new FakeBackend(identityCase.RootElement)), NullLogger<OrderTracking>.Instance);
        var reviews = new OrderReviews(() => db, new FakeBackend(identityCase.RootElement), reviewTracking, NullLogger<OrderReviews>.Instance);
        var reviewedOrder = db.Collection("orders").Document();
        await reviewedOrder.SetAsync(new { uid = "user-a", customerName = "FlowerFlow Admin", status = "Chờ xác nhận",
            items = new[] { new { id = flowerRef.Id, quantity = 2, title = "Hoa hồng" } } });
        var reviewPayload = JsonSerializer.Serialize(new { orderId = reviewedOrder.Id, rating = 4, comment = "Hoa đẹp", photos = new[] { "data:image/jpeg;base64," + Convert.ToBase64String(jpeg) } });
        var undelivered = JsonContext(reviewPayload); await reviews.SubmitReviewAsync(undelivered);
        AdditionalContracts.Require(undelivered.Response.StatusCode == 409, "Undelivered order reviewed");
        await reviewedOrder.UpdateAsync(new Dictionary<string, object> { ["status"] = "Đã giao" });
        var firstReview = JsonContext(reviewPayload); var duplicateReview = JsonContext(reviewPayload);
        await Task.WhenAll(reviews.SubmitReviewAsync(firstReview), reviews.SubmitReviewAsync(duplicateReview));
        AdditionalContracts.Require(new[] { firstReview.Response.StatusCode, duplicateReview.Response.StatusCode }.Order().SequenceEqual(new[] { 201, 409 }),
            "Concurrent duplicate review was accepted");
        var savedReview = await db.Collection("reviews").Document(OrderReviews.ReviewIdForOrder(reviewedOrder.Id)).GetSnapshotAsync();
        AdditionalContracts.Require(savedReview.GetValue<string>("moderationStatus") == "pending"
            && savedReview.GetValue<string>("customerName") == "Khách hàng" && !savedReview.ContainsField("orderId"), "Review moderation/name/privacy changed");
        var ownReview = JsonContext(JsonSerializer.Serialize(new { orderId = reviewedOrder.Id })); await reviews.GetOwnReviewAsync(ownReview);
        AdditionalContracts.Require(ownReview.Response.StatusCode == 200, "Owner review lookup failed");
        Console.WriteLine("PASS: delivered-owner reviews, one review under concurrent requests, pending moderation, name protection and own review lookup.");
        var paymentAdmin = new PaymentAdmin(() => db, photoAuth, NullLogger<PaymentAdmin>.Instance);
        await adminRef.SetAsync(new { role = "admin" });
        var qrOrder = db.Collection("orders").Document();
        await qrOrder.SetAsync(new { paymentMethod = "qr", total = 100000, status = "Chờ xác nhận", inventoryState = "reserved", paymentReference = "FFPAY" });
        var mismatch = JsonContext(JsonSerializer.Serialize(new { orderId = qrOrder.Id, amount = 99999, reconciliationReference = "BANK001" }));
        await paymentAdmin.ReconcileQrPaymentAsync(mismatch); AdditionalContracts.Require(mismatch.Response.StatusCode == 409, "QR amount mismatch accepted");
        var reconciliation = JsonContext(JsonSerializer.Serialize(new { orderId = qrOrder.Id, amount = "100000", reconciliationReference = "BANK001" }));
        await paymentAdmin.ReconcileQrPaymentAsync(reconciliation); AdditionalContracts.Require(reconciliation.Response.StatusCode == 200, "QR verification failed");
        var repeated = JsonContext(JsonSerializer.Serialize(new { orderId = qrOrder.Id, amount = 100000, reconciliationReference = "BANK001" }));
        await paymentAdmin.ReconcileQrPaymentAsync(repeated); AdditionalContracts.Require(repeated.Response.StatusCode == 409, "QR verified twice");
        var refund = JsonContext(JsonSerializer.Serialize(new { orderId = qrOrder.Id, refundReference = "REFUND001" }));
        await paymentAdmin.RecordPaymentRefundAsync(refund); AdditionalContracts.Require(refund.Response.StatusCode == 200, "Refund recording failed");
        var repeatedRefund = JsonContext(JsonSerializer.Serialize(new { orderId = qrOrder.Id, refundReference = "REFUND002" }));
        await paymentAdmin.RecordPaymentRefundAsync(repeatedRefund); AdditionalContracts.Require(repeatedRefund.Response.StatusCode == 409, "Refund recorded twice");
        var qrAudit = ImageContext(""); qrAudit.Request.QueryString = new QueryString("?orderId=" + qrOrder.Id); qrAudit.Request.Headers.Authorization = "Bearer token";
        await paymentAdmin.GetQrPaymentAuditAsync(qrAudit);
        using var qrAuditBody = JsonDocument.Parse(((MemoryStream)qrAudit.Response.Body).ToArray());
        AdditionalContracts.Require(qrAuditBody.RootElement.GetProperty("entries").GetArrayLength() == 2, "Verification/refund audit not atomic or duplicated");
        var lateOrder = db.Collection("orders").Document();
        await lateOrder.SetAsync(new { paymentMethod = "qr", total = 100000, status = "Đã hủy", inventoryState = "released" });
        var lateContext = JsonContext(JsonSerializer.Serialize(new { orderId = lateOrder.Id, amount = 100000, reconciliationReference = "LATE001" }));
        await paymentAdmin.ReconcileQrPaymentAsync(lateContext, true);
        var lateData = await lateOrder.GetSnapshotAsync();
        AdditionalContracts.Require(lateContext.Response.StatusCode == 200 && lateData.GetValue<bool>("latePayment")
            && lateData.GetValue<string>("status") == "Đã hủy" && lateData.GetValue<string>("inventoryState") == "released", "Late payment silently restored cancelled stock/order");
        await adminRef.DeleteAsync();
        Console.WriteLine("PASS: QR exact amount, one-time verification/refund, transactional audit and late payment without restoring released stock.");
        var loginAccounts = new TestFirebaseAccounts(); var loginProvider = new TestPasswordProvider("http-login-" + suffix);
        long loginNow = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var login = new LoginHandler(loginAccounts, () => loginProvider, () => new LoginProtection(db, () => loginNow));
        for (var failure = 1; failure <= 5; failure++)
        {
            var request = JsonContext("{\"email\":\" User@Example.Invalid \",\"password\":\"bad\"}"); await login.HandleAsync(request);
            AdditionalContracts.Require(request.Response.StatusCode == (failure < 5 ? 401 : 429), "Login HTTP lock policy changed");
            if (failure == 5) AdditionalContracts.Require(request.Response.Headers.RetryAfter == "900", "Login retry-after changed");
        }
        loginProvider.Valid = true; var lockedLogin = JsonContext("{\"email\":\"user@example.invalid\",\"password\":\"correct\"}");
        await login.HandleAsync(lockedLogin);
        AdditionalContracts.Require(lockedLogin.Response.StatusCode == 429 && loginProvider.Verifications == 5 && loginAccounts.TokenCreations == 0,
            "Locked account reached password check or custom token minting");
        loginNow += 15 * 60_000L; var goodLogin = JsonContext("{\"email\":\"user@example.invalid\",\"password\":\"correct\"}");
        await login.HandleAsync(goodLogin);
        using var loginBody = JsonDocument.Parse(((MemoryStream)goodLogin.Response.Body).ToArray());
        AdditionalContracts.Require(goodLogin.Response.StatusCode == 200 && loginAccounts.TokenCreations == 1
            && loginBody.RootElement.EnumerateObject().Single().Name == "customToken" && loginProvider.LastEmail == "user@example.invalid",
            "Protected login did not return only customToken");
        loginProvider.Outage = true; var outageLogin = JsonContext("{\"email\":\"user@example.invalid\",\"password\":\"correct\"}"); await login.HandleAsync(outageLogin);
        var outageState = await db.Collection("loginProtection").Document("http-login-" + suffix).GetSnapshotAsync();
        AdditionalContracts.Require(outageLogin.Response.StatusCode == 503 && outageState.GetValue<double>("failures") == 0
            && loginAccounts.TokenCreations == 1 && !Encoding.UTF8.GetString(((MemoryStream)outageLogin.Response.Body).ToArray()).Contains("private-provider-detail"),
            "Login provider outage counted failure, minted token or leaked details");
        loginProvider.Outage = false; loginProvider.Valid = false;
        var disconnectedLogin = JsonContext("{\"email\":\"user@example.invalid\",\"password\":\"wrong\"}");
        await JsonInput.ReadAsync(disconnectedLogin); disconnectedLogin.RequestAborted = new CancellationToken(true);
        try { await login.HandleAsync(disconnectedLogin); } catch (OperationCanceledException) { }
        AdditionalContracts.Require((await db.Collection("loginProtection").Document("http-login-" + suffix).GetSnapshotAsync()).GetValue<double>("failures") == 1,
            "Disconnect bypassed wrong-password accounting");
        Console.WriteLine("PASS: login HTTP normalization/errors, lock retry-after, no password check while locked, custom-token-only success and provider outage cleanup.");
        var managedAccounts = new TestFirebaseAccounts();
        managedAccounts.Users["customer-" + suffix] = new FirebaseAccount("customer-" + suffix, "customer@example.invalid", "Customer", false,
            new Dictionary<string, object> { ["loyalty"] = true }, new[] { "password" }, "Mon, 01 Jan 2024 00:00:00 GMT", "");
        var managedUsers = new AdminUsersHandler(managedAccounts, () => db, auditAuth, auditHandler, NullLogger<AdminUsersHandler>.Instance);
        var userList = JsonContext("{\"pageToken\":\"previous-page\"}"); await managedUsers.HandleAsync(userList);
        using var userListBody = JsonDocument.Parse(((MemoryStream)userList.Response.Body).ToArray());
        AdditionalContracts.Require(userList.Response.StatusCode == 200 && managedAccounts.LastPageToken == "previous-page"
            && userListBody.RootElement.GetProperty("nextPageToken").GetString() == "next-page"
            && userListBody.RootElement.GetProperty("users")[0].EnumerateObject().Count() == 8, "Admin listing fields/pagination changed");
        var invalidPage = JsonContext("{\"pageToken\":1}"); await managedUsers.HandleAsync(invalidPage);
        AdditionalContracts.Require(invalidPage.Response.StatusCode == 400, "Non-string pagination accepted");
        var auditAlias = ImageContext(""); auditAlias.Request.QueryString = new QueryString("?route=audit"); auditAlias.Request.Headers.Authorization = "Bearer token";
        await managedUsers.HandleAsync(auditAlias); AdditionalContracts.Require(auditAlias.Response.StatusCode == 200
            && auditAlias.Response.Headers.CacheControl == "private, no-store", "Admin audit route alias broken");
        Console.WriteLine("PASS: admin account listing whitelist, pagination validation and protected legacy audit route alias.");
        using var ownerPermissions = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\",\"admin\":true,\"role\":\"owner\"},\"roleExists\":true,\"role\":\"owner\"}");
        var ownerUsersAuth = new FirebaseAdminService(new FakeBackend(ownerPermissions.RootElement), NullLogger<FirebaseAdminService>.Instance);
        var ownerUsers = new OwnerUsersHandler(managedAccounts, () => db, ownerUsersAuth, NullLogger<OwnerUsersHandler>.Instance);
        var targetUid = "customer-" + suffix;
        var grantAdmin = JsonContext(JsonSerializer.Serialize(new { action = "grant-admin", uid = targetUid })); await ownerUsers.HandleAsync(grantAdmin);
        AdditionalContracts.Require(grantAdmin.Response.StatusCode == 200 && managedAccounts.Users[targetUid].Role == "admin"
            && managedAccounts.Users[targetUid].CustomClaims.GetValueOrDefault("loyalty") is true
            && (await db.Collection("adminRoles").Document(targetUid).GetSnapshotAsync()).Exists && managedAccounts.RevokedUsers.Contains(targetUid),
            "Grant failed to preserve claims/mirror/revoke");
        var removeAdmin = JsonContext(JsonSerializer.Serialize(new { action = "remove-admin", uid = targetUid })); await ownerUsers.HandleAsync(removeAdmin);
        AdditionalContracts.Require(removeAdmin.Response.StatusCode == 200 && managedAccounts.Users[targetUid].Role == "customer"
            && !managedAccounts.Users[targetUid].CustomClaims.ContainsKey("admin")
            && !(await db.Collection("adminRoles").Document(targetUid).GetSnapshotAsync()).Exists, "Admin removal left a live role");
        var selfChange = JsonContext("{\"action\":\"grant-admin\",\"uid\":\"user-a\"}"); await ownerUsers.HandleAsync(selfChange);
        AdditionalContracts.Require(selfChange.Response.StatusCode == 400, "Owner changed own role");
        var otherOwnerId = "owner-other-" + suffix;
        managedAccounts.Users[otherOwnerId] = new FirebaseAccount(otherOwnerId, null, null, false,
            new Dictionary<string, object> { ["admin"] = true, ["role"] = "owner" }, [], "", "");
        var changeOwner = JsonContext(JsonSerializer.Serialize(new { action = "remove-admin", uid = otherOwnerId })); await ownerUsers.HandleAsync(changeOwner);
        AdditionalContracts.Require(changeOwner.Response.StatusCode == 403, "Owner downgraded another owner");
        managedAccounts.FailRevocation = true;
        var partialGrant = JsonContext(JsonSerializer.Serialize(new { action = "grant-admin", uid = targetUid })); await ownerUsers.HandleAsync(partialGrant);
        using var partialBody = JsonDocument.Parse(((MemoryStream)partialGrant.Response.Body).ToArray());
        AdditionalContracts.Require(partialGrant.Response.StatusCode == 500 && partialBody.RootElement.GetProperty("code").GetString() == "role-updated-session-revoke-failed"
            && managedAccounts.Users[targetUid].Role == "admin" && (await db.Collection("adminRoles").Document(targetUid).GetSnapshotAsync()).Exists,
            "Role change partial-success error concealed applied state");
        managedAccounts.FailRevocation = false;
        var ownerList = JsonContext("{\"action\":\"list\"}"); await ownerUsers.HandleAsync(ownerList);
        using var ownerListBody = JsonDocument.Parse(((MemoryStream)ownerList.Response.Body).ToArray());
        AdditionalContracts.Require(ownerList.Response.StatusCode == 200 && ownerListBody.RootElement.GetProperty("users")[0].EnumerateObject().Count() == 5
            && (await db.Collection("adminRoles").Document(otherOwnerId).GetSnapshotAsync()).GetValue<string>("role") == "owner", "Owner list/backfill changed");
        Console.WriteLine("PASS: owner grant/remove, retained custom claims, live role revocation, owner protection, backfill and partial session-revoke failure.");
        await CheckoutContracts.RunAsync(db);
        await PaymentsContracts.RunAsync(db);
    }
}
