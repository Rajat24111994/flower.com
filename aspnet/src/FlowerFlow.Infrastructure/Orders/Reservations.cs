using System.Globalization;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Application.Orders;
using FlowerFlow.Infrastructure.Firebase;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Logging;

namespace FlowerFlow.Infrastructure.Orders;

/// <summary>Port of backend/orders/reservations.js. Stock release is idempotent and transactional.</summary>
public sealed class Reservations(ILogger<Reservations> logger)
{
    public Task<bool> ExpireOneReservationAsync(FirestoreDb db, DocumentReference orderRef, Timestamp now,
        CancellationToken cancellationToken = default) => db.RunTransactionAsync(async transaction =>
    {
        var snapshot = await transaction.GetSnapshotAsync(orderRef, cancellationToken);
        if (!snapshot.Exists) return false;
        var order = snapshot.ToDictionary();
        var expires = order.GetValueOrDefault("reservationExpiresAt");
        var reserved = order.GetValueOrDefault("inventoryReserved") is true;
        var originalStatus = order.GetValueOrDefault("status") as string;
        if (reserved && originalStatus != "Chờ xác nhận" && expires is not null
            && (expires is Timestamp || Js.Truthy(Js.Element(expires))))
        {
            transaction.Update(orderRef, new Dictionary<string, object> { ["reservationExpiresAt"] = FieldValue.Delete }); return false;
        }
        if (!reserved || expires is not Timestamp expiresAt || FirestoreValues.ToMillis(expiresAt) > FirestoreValues.ToMillis(now)) return false;
        var paymentStatus = Js.StringOrEmpty(Js.Element(order.GetValueOrDefault("paymentStatus"))).Trim().ToLower(CultureInfo.GetCultureInfo("vi-VN"));
        if (order.GetValueOrDefault("paymentVerified") is true || new[] { "đã thanh toán", "paid", "da_thanh_toan", "đã hoàn tiền" }.Contains(paymentStatus))
        {
            transaction.Update(orderRef, new Dictionary<string, object> { ["reservationExpiresAt"] = FieldValue.Delete }); return false;
        }
        var items = OrderPricing.AggregateItems(Js.Element(order.GetValueOrDefault("items")));
        var txn = order.GetValueOrDefault("vnpTxnRef");
        var attemptRef = order.GetValueOrDefault("paymentMethod") is "vnpay" && Js.Truthy(Js.Element(txn))
            ? db.Collection("paymentTransactions").Document(Js.String(Js.Element(txn))) : null;
        var attempt = attemptRef is null ? null : await transaction.GetSnapshotAsync(attemptRef, cancellationToken);
        var restore = originalStatus != "Đã giao";
        var productRefs = restore ? items.Select(item => db.Collection("products").Document((string)item["id"])).ToList() : [];
        var products = new List<DocumentSnapshot>();
        foreach (var product in productRefs) products.Add(await transaction.GetSnapshotAsync(product, cancellationToken));
        var status = restore ? "Đã hủy" : originalStatus;
        var location = restore ? "Đơn hàng hết thời hạn giữ sản phẩm" : order.GetValueOrDefault("currentLocation") as string ?? "";
        var changes = new Dictionary<string, object>
        {
            ["status"] = status!, ["currentLocation"] = location, ["inventoryReserved"] = false,
            ["inventoryState"] = restore ? "released" : "sold", ["reservationExpiredAt"] = now, ["trackingUpdatedAt"] = now
        };
        if (order.GetValueOrDefault("paymentMethod") is "qr" && order.GetValueOrDefault("paymentVerified") is not true)
            changes["paymentStatus"] = "Hết hạn chờ thanh toán";
        else if (order.GetValueOrDefault("paymentMethod") is "vnpay" && order.GetValueOrDefault("paymentVerified") is not true)
        { changes["paymentStatus"] = "that_bai"; changes["vnpResponseCode"] = "expired"; }
        for (var index = 0; index < products.Count; index++)
        {
            if (!products[index].Exists) continue;
            var quantity = Js.NumberOrZero(Js.Element(products[index].ToDictionary().GetValueOrDefault("quantity")));
            transaction.Update(products[index].Reference, new Dictionary<string, object>
                { ["quantity"] = quantity + Convert.ToDouble(items[index]["quantity"], CultureInfo.InvariantCulture) });
        }
        var history = order.GetValueOrDefault("trackingHistory") is IEnumerable<object> events ? events.ToList() : [];
        history.Add(new Dictionary<string, object> { ["status"] = status!, ["location"] = location, ["estimatedDelivery"] = "",
            ["updatedAt"] = now.ToDateTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) });
        changes["trackingHistory"] = history;
        transaction.Update(orderRef, changes);
        if (attempt?.Exists == true && attempt.ToDictionary().GetValueOrDefault("status") is "pending")
            transaction.Update(attemptRef!, new Dictionary<string, object> { ["status"] = "expired", ["processedAt"] = now });
        return true;
    }, cancellationToken: cancellationToken);

    public async Task<int> ExpireReservationsAsync(FirestoreDb db, int maxOrders = 500, CancellationToken cancellationToken = default)
    {
        var released = 0; var scanned = 0;
        while (released < maxOrders && scanned < maxOrders)
        {
            var now = Timestamp.FromDateTime(DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).UtcDateTime);
            var snapshot = await db.Collection("orders").WhereEqualTo("inventoryReserved", true)
                .WhereLessThanOrEqualTo("reservationExpiresAt", now).OrderBy("reservationExpiresAt")
                .Limit(Math.Min(100, maxOrders - scanned)).GetSnapshotAsync(cancellationToken);
            if (snapshot.Count == 0) break;
            scanned += snapshot.Count;
            var results = await Task.WhenAll(snapshot.Documents.Select(document => ExpireOneReservationAsync(db, document.Reference, now, cancellationToken)));
            released += results.Count(result => result);
        }
        return released;
    }

    public async Task ReleaseExpiredReservationsAsync(FirestoreDb db, CancellationToken cancellationToken = default)
    {
        try { await ExpireReservationsAsync(db, cancellationToken: cancellationToken); }
        catch { logger.LogError("Reservation cleanup failed."); }
    }
}
