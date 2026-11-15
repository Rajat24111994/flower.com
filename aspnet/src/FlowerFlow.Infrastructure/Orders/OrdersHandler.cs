using System.Text.Json;
using System.Text.RegularExpressions;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Infrastructure.Http;
using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Orders;

/// <summary>Port of backend/orders/controller.js. Preserves legacy actions, methods and the default create action.</summary>
public sealed class OrdersHandler(Checkout checkout, OrderTracking tracking, OrderReviews reviews, PaymentAdmin payments,
    Reservations reservations, Func<FirestoreDb> database, ILogger<OrdersHandler> logger)
{
    public async Task HandleAsync(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method == "POST")
        {
            var action = Js.Get(await JsonInput.ReadAsync(context), "action");
            var name = action.ValueKind == JsonValueKind.String ? action.GetString() : null;
            switch (name)
            {
                case "verify-qr-payment": await payments.ReconcileQrPaymentAsync(context); return;
                case "record-late-qr-payment": await payments.ReconcileQrPaymentAsync(context, true); return;
                case "record-payment-refund": await payments.RecordPaymentRefundAsync(context); return;
                case "quote": await checkout.QuoteOrderAsync(context); return;
                case "lookup": await tracking.LookupOrderAsync(context); return;
                case "review": await reviews.SubmitReviewAsync(context); return;
                case "review-get": await reviews.GetOwnReviewAsync(context); return;
                default: await checkout.CreateOrderAsync(context); return;
            }
        }
        if (context.Request.Method != "GET")
        {
            context.Response.Headers.Allow = "GET, POST";
            await FirebaseAdminService.SendErrorAsync(context, 405, "method-not-allowed", "API đơn hàng chỉ chấp nhận phương thức GET hoặc POST."); return;
        }
        var queryAction = context.Request.Query["action"].ToString();
        if (queryAction == "payment-audit") { await payments.GetQrPaymentAuditAsync(context); return; }
        if (queryAction == "mine") { await tracking.AccountOrdersAsync(context); return; }
        if (queryAction == "expire")
        {
            var match = Regex.Match(context.Request.Headers.Authorization.ToString(), @"^Bearer\s+([^\r\n\u2028\u2029]+)$", RegexOptions.IgnoreCase);
            var cron = Environment.GetEnvironmentVariable("CRON_SECRET");
            var authorized = !string.IsNullOrEmpty(cron) && match.Success && match.Groups[1].Value == cron;
            if (!authorized && match.Success)
            {
                if (await payments.AuthorizeOrderAdminAsync(context) is null) return;
                authorized = true;
            }
            if (!authorized) { await FirebaseAdminService.SendErrorAsync(context, 401, "unauthenticated", "Quyền dọn đơn hết hạn không hợp lệ."); return; }
            try
            {
                var released = await reservations.ExpireReservationsAsync(database(), cancellationToken: context.RequestAborted);
                await context.Response.WriteAsJsonAsync(new { released }, context.RequestAborted);
            }
            catch { logger.LogError("Reservation cleanup failed."); await FirebaseAdminService.SendErrorAsync(context, 503, "order-service-unavailable", "Chưa thể giải phóng tồn kho đơn hết hạn."); }
            return;
        }
        await FirebaseAdminService.SendErrorAsync(context, 405, "method-not-allowed", "Tra cứu đơn hàng cần dùng phương thức POST.");
    }
}
