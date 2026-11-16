using System.Collections;
using System.Globalization;
using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Admin;

/// <summary>Port of backend/admin/audit.js.</summary>
public sealed class AdminAuditHandler(Func<FirestoreDb> database, FirebaseAdminService authentication,
    ILogger<AdminAuditHandler> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store";
        Task Error(int status, string code, string message) => FirebaseAdminService.SendErrorAsync(context, status, code, message);
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = "GET";
            await Error(405, "method-not-allowed", "API nhật ký quản trị chỉ chấp nhận GET."); return;
        }
        FirestoreDb db;
        try { db = database(); }
        catch { await Error(503, "admin-api-not-configured", "API nhật ký quản trị chưa được cấu hình."); return; }
        if (await authentication.VerifyAdminRequestAsync(context) is null) return;
        try
        {
            var snapshot = await db.Collection("adminAudit").OrderByDescending("createdAt").Limit(100).GetSnapshotAsync(context.RequestAborted);
            var entries = snapshot.Documents.Select(document =>
            {
                var data = document.ToDictionary();
                string Text(string key) => Convert.ToString(data.GetValueOrDefault(key), CultureInfo.InvariantCulture) ?? "";
                var details = data.GetValueOrDefault("details");
                return new
                {
                    id = document.Id, actorUid = Text("actorUid"), actorEmail = Text("actorEmail"), action = Text("action"),
                    resourceType = Text("resourceType"), resourceId = Text("resourceId"),
                    details = details is IDictionary or IList ? details : new Dictionary<string, object>(),
                    createdAt = data.GetValueOrDefault("createdAt") is Timestamp timestamp
                        ? FirestoreValues.ToIso(timestamp) : ""
                };
            }).ToList();
            await context.Response.WriteAsJsonAsync(new { entries }, context.RequestAborted);
        }
        catch
        {
            logger.LogError("Admin audit read failed.");
            await Error(503, "admin-audit-unavailable", "Chưa thể tải nhật ký thao tác quản trị.");
        }
    }
}
