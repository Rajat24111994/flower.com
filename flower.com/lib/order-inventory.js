class InventoryReservationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "InventoryReservationError";
        this.code = code;
    }
}

function normalizeReservationItems(items) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        throw new InventoryReservationError("invalid-argument", "A valid list of order items is required.");
    }

    const normalizedItems = items.map((item) => {
        const id = String(item && item.id !== undefined ? item.id : "").trim();
        const quantity = Number(item && item.quantity);
        if (!id || id.length > 128 || id.includes("/")
            || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
            throw new InventoryReservationError("invalid-argument", "An order item is invalid.");
        }
        return { id, quantity };
    }).sort((first, second) => first.id.localeCompare(second.id));

    if (normalizedItems.some((item, index) => index > 0 && item.id === normalizedItems[index - 1].id)) {
        throw new InventoryReservationError("invalid-argument", "An order cannot contain duplicate product IDs.");
    }
    return normalizedItems;
}

function normalizeOrderId(orderId) {
    const value = String(orderId || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new InventoryReservationError("invalid-argument", "A valid order ID is required.");
    }
    return value;
}

async function reserveInventory(db, orderId, items) {
    const normalizedOrderId = normalizeOrderId(orderId);
    const normalizedItems = normalizeReservationItems(items);
    const reservationRef = db.collection("inventoryReservations").doc(normalizedOrderId);

    return db.runTransaction(async (transaction) => {
        const reservationSnapshot = await transaction.get(reservationRef);
        if (reservationSnapshot.exists) {
            const reservation = reservationSnapshot.data();
            const previousItems = Array.isArray(reservation.items) ? reservation.items : [];
            const hasSameItems = JSON.stringify(previousItems.map(({ id, quantity }) => ({ id, quantity })))
                === JSON.stringify(normalizedItems);
            if (!hasSameItems) {
                throw new InventoryReservationError("order-id-conflict", "This order ID was already used.");
            }
            const productSnapshots = await Promise.all(previousItems.map(({ id }) => (
                transaction.get(db.collection("products").doc(id))
            )));
            return {
                alreadyReserved: true,
                stocks: productSnapshots.flatMap((snapshot, index) => (
                    snapshot.exists
                        ? [{ id: previousItems[index].id, quantity: Number(snapshot.data().quantity) }]
                        : []
                ))
            };
        }

        const productRefs = normalizedItems.map(({ id }) => db.collection("products").doc(id));
        const productSnapshots = await Promise.all(productRefs.map((productRef) => transaction.get(productRef)));
        const reservedItems = productSnapshots.map((snapshot, index) => {
            if (!snapshot.exists) {
                throw new InventoryReservationError("product-not-found", "A product in this order no longer exists.");
            }
            const stock = Number(snapshot.data().quantity);
            const requestedQuantity = normalizedItems[index].quantity;
            if (!Number.isInteger(stock) || stock < requestedQuantity) {
                throw new InventoryReservationError("insufficient-stock", "There is not enough stock to complete this order.");
            }
            return {
                ...normalizedItems[index],
                remainingStock: stock - requestedQuantity
            };
        });

        reservedItems.forEach((item, index) => {
            transaction.update(productSnapshots[index].ref, { quantity: item.remainingStock });
        });
        transaction.create(reservationRef, {
            items: reservedItems,
            createdAt: Date.now()
        });

        return {
            alreadyReserved: false,
            stocks: reservedItems.map(({ id, remainingStock }) => ({ id, quantity: remainingStock }))
        };
    });
}

module.exports = { InventoryReservationError, reserveInventory };
