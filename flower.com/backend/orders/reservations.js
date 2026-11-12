// Giữ kho và hoàn kho: hủy đơn quá hạn giữ hàng và trả lại tồn kho trong transaction.
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { aggregateItems } = require("./pricing");

async function expireOneReservation(db, orderRef, now) {
    return db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        if (!orderSnapshot.exists) return false;
        const order = orderSnapshot.data();
        const expiresAt = order.reservationExpiresAt;
        // Only orders still waiting for the shop's confirmation expire; once an admin has
        // confirmed or shipped an order, its stock stays reserved. Older confirmed orders may
        // still carry a hold timer: drop it so they stop matching the cleanup query.
        if (order.inventoryReserved === true && order.status !== "Chờ xác nhận" && expiresAt) {
            transaction.update(orderRef, { reservationExpiresAt: FieldValue.delete() });
            return false;
        }
        if (order.inventoryReserved !== true || typeof expiresAt?.toMillis !== "function"
            || expiresAt.toMillis() > now.toMillis()) return false;
        if (order.paymentVerified === true
            || ["đã thanh toán", "paid", "da_thanh_toan", "đã hoàn tiền"].includes(String(order.paymentStatus || "").trim().toLocaleLowerCase("vi"))) {
            transaction.update(orderRef, { reservationExpiresAt: FieldValue.delete() });
            return false;
        }

        const items = aggregateItems(order.items);
        const paymentAttemptRef = order.paymentMethod === "vnpay" && order.vnpTxnRef
            ? db.collection("paymentTransactions").doc(String(order.vnpTxnRef))
            : null;
        const paymentAttempt = paymentAttemptRef ? await transaction.get(paymentAttemptRef) : null;
        const shouldRestoreStock = order.status !== "Đã giao";
        const productRefs = shouldRestoreStock
            ? items.map((item) => db.collection("products").doc(item.id))
            : [];
        const productSnapshots = [];
        for (const productRef of productRefs) productSnapshots.push(await transaction.get(productRef));

        const expiredAt = new Date(now.toMillis()).toISOString();
        const status = shouldRestoreStock ? "Đã hủy" : order.status;
        const location = shouldRestoreStock ? "Đơn hàng hết thời hạn giữ sản phẩm" : order.currentLocation || "";
        const paymentExpiryChanges = order.paymentMethod === "qr" && order.paymentVerified !== true
            ? { paymentStatus: "Hết hạn chờ thanh toán" }
            : order.paymentMethod === "vnpay" && order.paymentVerified !== true
                ? { paymentStatus: "that_bai", vnpResponseCode: "expired" }
                : {};
        productSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) return;
            const currentQuantity = Number(snapshot.data().quantity) || 0;
            transaction.update(snapshot.ref, { quantity: currentQuantity + items[index].quantity });
        });

        transaction.update(orderRef, {
            status,
            currentLocation: location,
            inventoryReserved: false,
            inventoryState: shouldRestoreStock ? "released" : "sold",
            reservationExpiredAt: Timestamp.fromMillis(now.toMillis()),
            ...paymentExpiryChanges,
            trackingUpdatedAt: Timestamp.fromMillis(now.toMillis()),
            trackingHistory: [...(Array.isArray(order.trackingHistory) ? order.trackingHistory : []), {
                status,
                location,
                estimatedDelivery: "",
                updatedAt: expiredAt
            }]
        });
        if (paymentAttempt?.exists && paymentAttempt.data().status === "pending") {
            transaction.update(paymentAttemptRef, {
                status: "expired",
                processedAt: Timestamp.fromMillis(now.toMillis())
            });
        }
        return true;
    });
}

async function expireReservations(db, maxOrders = 500) {
    let released = 0;
    const batchSize = 100;
    let scanned = 0;
    while (released < maxOrders && scanned < maxOrders) {
        const now = Timestamp.now();
        const snapshot = await db.collection("orders")
            .where("inventoryReserved", "==", true)
            .where("reservationExpiresAt", "<=", now)
            .orderBy("reservationExpiresAt", "asc")
            .limit(Math.min(batchSize, maxOrders - scanned))
            .get();
        if (snapshot.empty) break;
        scanned += snapshot.size;
        const results = await Promise.all(snapshot.docs.map((document) => expireOneReservation(db, document.ref, now)));
        const batchReleased = results.filter(Boolean).length;
        released += batchReleased;
    }
    return released;
}

// Cleanup must never block quoting or ordering: log and continue.
async function releaseExpiredReservations(db) {
    try {
        await expireReservations(db);
    } catch (error) {
        console.error("Reservation cleanup failed:", error.code || "unknown");
    }
}

module.exports = { expireOneReservation, expireReservations, releaseExpiredReservations };
