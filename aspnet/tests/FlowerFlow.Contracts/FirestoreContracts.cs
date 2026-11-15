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
    }
}
