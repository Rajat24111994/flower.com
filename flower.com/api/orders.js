const bouquet = require("../js/catalog/bouquet-options.js");
const { validateReviewPhotos } = require("../lib/review-images");
const { createHash, createHmac } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError } = require("../lib/firebase-admin");
// Same price reading as the shop pages (whole VND, old USD prices converted), so both agree.
const { toVndPrice } = require("../js/catalog/product-store.js");

const MAX_QUANTITY_PER_PRODUCT = 50;
const QR_RESERVATION_MS = 30 * 60 * 1000;
const VNPAY_RESERVATION_MS = 15 * 60 * 1000;
const COD_RESERVATION_MS = 24 * 60 * 60 * 1000;
const ORDER_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const ORDER_LOOKUP_MAX_ATTEMPTS = 20;
const DELIVERY_TIME_WINDOWS = ["08:00–11:00", "11:00–14:00", "14:00–17:00", "17:00–20:00"];
const DELIVERY_TIME_ZONE = "Asia/Ho_Chi_Minh";

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function getVietnameseDateTime(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DELIVERY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        hour: Number(values.hour),
        minute: Number(values.minute)
    };
}

function deliveryScheduleError(deliveryDate, deliveryTime, now = new Date()) {
    const dateTimestamp = Date.parse(`${deliveryDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
        || !Number.isFinite(dateTimestamp)
        || new Date(dateTimestamp).toISOString().slice(0, 10) !== deliveryDate) {
        return "Ngày giao không hợp lệ.";
    }
    if (!DELIVERY_TIME_WINDOWS.includes(deliveryTime)) return "Vui lòng chọn khung giờ giao hợp lệ.";
    const localNow = getVietnameseDateTime(now);
    if (deliveryDate < localNow.date) return "Ngày giao không thể ở quá khứ.";
    if (deliveryDate !== localNow.date) return "";
    if (localNow.hour >= 15) return "Đã qua 15:00 tại Việt Nam. Vui lòng chọn ngày giao khác.";
    const startHour = Number(deliveryTime.slice(0, 2));
    if (startHour <= localNow.hour) {
        return "Khung giờ giao đã bắt đầu. Vui lòng chọn khung giờ sau hoặc ngày khác.";
    }
    return "";
}

function getEnabledDeliveryZones(data) {
    return (Array.isArray(data?.zones) ? data.zones : [])
        .filter((zone) => zone && zone.enabled === true
            && typeof zone.id === "string"
            && typeof zone.province === "string"
            && typeof zone.district === "string"
            && Number.isSafeInteger(zone.fee) && zone.fee >= 0);
}

function resolveDeliveryZone(data, zoneId) {
    if (!zoneId) return { zone: null, shippingFee: 0 };
    const zone = getEnabledDeliveryZones(data).find((item) => item.id === zoneId);
    if (!zone) {
        const error = new Error("Khu vực giao hàng không còn khả dụng. Hãy chọn lại khu vực.");
        error.code = "delivery-zone-unavailable";
        throw error;
    }
    return { zone, shippingFee: zone.fee };
}

function aggregateItems(items) {
    const quantities = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
        const id = String(item?.productId ?? item?.id ?? "");
        quantities.set(id, (quantities.get(id) || 0) + Math.max(1, Number(item?.quantity) || 1));
    });
    return Array.from(quantities, ([id, quantity]) => ({ id, quantity }));
}

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
            || expiresAt.toMillis() > now.toMillis()
            || (order.paymentMethod === "qr" && order.paymentVerified === true)) return false;

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
    while (released < maxOrders) {
        const now = Timestamp.now();
        const snapshot = await db.collection("orders")
            .where("inventoryReserved", "==", true)
            .where("paymentVerified", "==", false)
            .where("reservationExpiresAt", "<=", now)
            .orderBy("reservationExpiresAt", "asc")
            .limit(Math.min(batchSize, maxOrders - released))
            .get();
        if (snapshot.empty) break;
        const results = await Promise.all(snapshot.docs.map((document) => expireOneReservation(db, document.ref, now)));
        const batchReleased = results.filter(Boolean).length;
        released += batchReleased;
        if (batchReleased === 0) break;
    }
    return released;
}

// Cleanup must never block quoting or ordering: log and continue.
async function releaseExpiredReservations(db) {
    try {
        await expireReservations(db);
    } catch (error) {
        console.error("Reservation cleanup failed:", error.code || error.message);
    }
}

function serializeTimestamp(value) {
    if (value && typeof value.toDate === "function") return value.toDate().toISOString();
    return typeof value === "string" ? value : "";
}

function publicTrackingOrder(id, data) {
    return {
        id,
        status: data.status || "Chờ xác nhận",
        estimatedDelivery: data.estimatedDelivery || "",
        trackingHistory: Array.isArray(data.trackingHistory)
            ? data.trackingHistory.map((event) => ({
                status: event.status || data.status || "Chờ xác nhận",
                estimatedDelivery: event.estimatedDelivery || "",
                updatedAt: serializeTimestamp(event.updatedAt) || event.updatedAt || ""
            }))
            : [],
        // What a customer needs to finish a QR transfer (no name, phone or address).
        ...(awaitsQrTransfer(data) ? {
            paymentMethod: "qr",
            paymentStatus: data.paymentStatus || "Chờ xác minh thanh toán",
            total: Number(data.total) || 0,
            paymentReference: data.paymentReference || "",
            reservationExpiresAt: serializeTimestamp(data.reservationExpiresAt)
        } : data.paymentMethod === "vnpay" ? {
            paymentMethod: "vnpay",
            paymentStatus: data.paymentStatus || "chua_thanh_toan"
        } : {}),
        privacyLimited: true
    };
}

function awaitsQrTransfer(data) {
    return data.paymentMethod === "qr" && data.paymentVerified !== true
        && ["Chờ xác nhận", "Đang chuẩn bị"].includes(data.status || "Chờ xác nhận");
}

async function checkOrderLookupLimit(db, req) {
    const forwardedFor = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "");
    const clientIp = forwardedFor.split(",")[0].trim();
    if (!clientIp) throw new Error("Client IP is unavailable for order lookup rate limiting.");

    const secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!secret) throw new Error("Firebase service credentials are required for order lookup rate limiting.");
    const key = createHmac("sha256", secret).update(clientIp).digest("hex");
    const limitRef = db.collection("orderLookupLimits").doc(key);
    const now = Timestamp.now();

    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(limitRef);
        const record = snapshot.exists ? snapshot.data() : {};
        const windowStartedAt = record.windowStartedAt?.toMillis?.() || 0;
        const sameWindow = now.toMillis() - windowStartedAt < ORDER_LOOKUP_WINDOW_MS;
        const attempts = sameWindow ? Number(record.attempts) || 0 : 0;
        if (attempts >= ORDER_LOOKUP_MAX_ATTEMPTS) {
            return {
                allowed: false,
                retryAfter: Math.max(1, Math.ceil((windowStartedAt + ORDER_LOOKUP_WINDOW_MS - now.toMillis()) / 1000))
            };
        }

        transaction.set(limitRef, {
            windowStartedAt: sameWindow ? record.windowStartedAt : now,
            attempts: attempts + 1,
            expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000)
        });
        return { allowed: true, retryAfter: 0 };
    });
}

function validateCheckout(body = {}) {
    const customerName = String(body.customerName || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const customerIsRecipient = body.customerIsRecipient === true;
    const recipientName = customerIsRecipient ? customerName : String(body.recipientName || customerName).trim();
    const recipientPhone = customerIsRecipient ? phone : String(body.recipientPhone || phone).trim();
    const deliveryDate = String(body.deliveryDate || "").trim();
    const deliveryTime = String(body.deliveryTime || "").trim();
    const greetingCard = String(body.greetingCard || "").trim();
    const anonymousGreetingCard = body.anonymousGreetingCard === true;
    const deliveryZoneId = String(body.deliveryZoneId || "").trim();
    const giftWrap = String(body.giftWrap || "none");
    const paymentMethod = String(body.paymentMethod || "");
    const promotionId = String(body.promotionId || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const items = body.items;
    const expectedTotals = body.expectedTotals;
    const deliveryDateTimestamp = Date.parse(`${deliveryDate}T00:00:00Z`);

    if (!customerName || customerName.length > 100
        || !address || address.length > 500
        || normalizePhone(phone).length < 8 || normalizePhone(phone).length > 15
        || recipientName.length > 120
        || normalizePhone(recipientPhone).length < 8 || normalizePhone(recipientPhone).length > 15
        || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
        || !Number.isFinite(deliveryDateTimestamp)
        || new Date(deliveryDateTimestamp).toISOString().slice(0, 10) !== deliveryDate
        || !DELIVERY_TIME_WINDOWS.includes(deliveryTime)
        || !/^[A-Za-z0-9_-]{1,80}$/.test(deliveryZoneId)
        || greetingCard.length > 300
        || !["none", "pastel", "classic"].includes(giftWrap)
        || !["qr", "cod", "vnpay"].includes(paymentMethod)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
        || promotionId.length > 100
        || !expectedTotals
        || !["subtotal", "savings", "tax", "shippingFee", "total"].every((key) => (
            Number.isSafeInteger(expectedTotals[key]) && expectedTotals[key] >= 0
        ))
        || !Array.isArray(items) || items.length < 1 || items.length > 50) {
        return null;
    }

    const normalizedItems = [];
    const seenIds = new Set();
    for (const item of items) {
        const id = String(item?.id ?? "").trim();
        const quantity = Number(item?.quantity);
        if (!id || id.length > 128 || id.includes("/") || seenIds.has(id)
            || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_PRODUCT) {
            return null;
        }
        seenIds.add(id);
        const options = bouquet.normalize(item);
        if (!options) return null;
        normalizedItems.push({ id, quantity, ...options });
    }

    return {
        customerName,
        phone,
        address,
        recipientName,
        recipientPhone,
        customerIsRecipient,
        deliveryDate,
        deliveryTime,
        greetingCard,
        anonymousGreetingCard,
        deliveryZoneId,
        giftWrap,
        paymentMethod,
        promotionId,
        idempotencyKey,
        expectedTotals,
        items: normalizedItems
    };
}

// Transfer content the shop matches bank statements against. Computed here from the request's
// unique idempotency key (the same formula checkout.html uses for the QR it shows), never taken
// from the browser, so nobody can reuse another order's content.
function paymentReferenceFor(idempotencyKey) {
    return `FF${String(idempotencyKey).replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function validateQuote(body = {}) {
    const promotionId = String(body.promotionId || "").trim();
    const deliveryZoneId = String(body.deliveryZoneId || "").trim();
    if (promotionId.length > 100
        || (deliveryZoneId && !/^[A-Za-z0-9_-]{1,80}$/.test(deliveryZoneId))
        || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return null;
    const seenIds = new Set();
    const items = [];
    for (const item of body.items) {
        const id = String(item?.id ?? "").trim();
        const quantity = Number(item?.quantity);
        if (!id || id.length > 128 || id.includes("/") || seenIds.has(id)
            || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_PRODUCT) return null;
        seenIds.add(id);
        const options = bouquet.normalize(item);
        if (!options) return null;
        items.push({ id, quantity, ...options });
    }
    return { items, promotionId, deliveryZoneId };
}

// The active promotion a checkout asked for, or null when it asked for none. Throws
// "invalid-promotion" for an unknown, inactive or malformed one.
function findPromotion(promotions, promotionId) {
    if (!promotionId) return null;
    const promotion = (Array.isArray(promotions) ? promotions : [])
        .find((item) => String(item.id) === String(promotionId) && item.active === true);
    if (!promotion) {
        const error = new Error("Ưu đãi đã hết hạn hoặc không hợp lệ. Hãy tải lại trang thanh toán.");
        error.code = "invalid-promotion";
        throw error;
    }
    const discountPercent = Number(promotion.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
        const error = new Error("Ưu đãi hiện không hợp lệ.");
        error.code = "invalid-promotion";
        throw error;
    }
    return promotion;
}

// Totals in whole VND for items { id, price (VND), quantity }, shared by the quote and the order
// (and mirrored by calculateCartTotals in currency.js) so all three always agree. The subtotal is
// exactly the sum of the lines; the discount is rounded once, to the nearest đồng.
function priceCart(items, promotion) {
    const discountPercent = promotion ? Number(promotion.discountPercent) : 0;
    const eligibleIds = new Set(Array.isArray(promotion?.productIds) ? promotion.productIds.map(String) : []);
    const appliesToAll = promotion?.allProducts === true;
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const savings = Math.min(subtotal, Math.round(items.reduce((sum, item) => sum + (promotion && (appliesToAll || eligibleIds.has(String(item.productId ?? item.id)))
        ? item.price * item.quantity * discountPercent / 100
        : 0), 0)));
    return { subtotal, savings, tax: 0, total: subtotal - savings };
}

// A clear answer for the one limit customers can actually hit, instead of "invalid list".
function quantityLimitError(res, body) {
    const tooMany = Array.isArray(body?.items) && body.items.some((item) => Number(item?.quantity) > MAX_QUANTITY_PER_PRODUCT);
    if (!tooMany) return null;
    return sendError(res, 400, "quantity-limit", `Mỗi lựa chọn bó hoa đặt tối đa ${MAX_QUANTITY_PER_PRODUCT} bó. Hãy giảm số lượng, hoặc liên hệ cửa hàng nếu cần số lượng lớn.`);
}

async function quoteOrder(req, res) {
    if (quantityLimitError(res, req.body)) return;
    const quote = validateQuote(req.body);
    if (!quote) return sendError(res, 400, "invalid-checkout", "Danh sách sản phẩm không hợp lệ.");
    try {
        const db = getAdminFirestore();
        await releaseExpiredReservations(db);
        const productRefs = quote.items.map((item) => db.collection("products").doc(item.productId ?? item.id));
        const [products, promotionsSnapshot, deliverySnapshot] = await Promise.all([
            db.getAll(...productRefs),
            db.collection("metadata").doc("activePromotions").get(),
            db.collection("metadata").doc("deliveryZones").get()
        ]);
        const { zone, shippingFee } = resolveDeliveryZone(deliverySnapshot.data(), quote.deliveryZoneId);
        // Report every product that cannot be sold in the asked quantity, with what is left, so the
        // checkout can tell the customer exactly what to change.
        const shortages = [];
        const cart = quote.items.map((item, index) => {
            const snapshot = products[index];
            const data = snapshot.exists ? snapshot.data() : {};
            const price = bouquet.price(toVndPrice(data.price), item.size);
            const stock = Number(data.quantity);
            if (data.status === "hidden") {
                shortages.push({
                    id: item.id,
                    title: String(data.title || "").slice(0, 120),
                    available: 0,
                    hidden: true
                });
                return { ...item, data, price, stock };
            }
            if (!snapshot.exists || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < bouquet.demand(quote.items, item.productId ?? item.id)) {
                shortages.push({
                    id: item.id,
                    title: String(data.title || "").slice(0, 120),
                    available: snapshot.exists && Number.isInteger(stock) && Number.isFinite(price) && price > 0 ? Math.max(0, stock) : 0
                });
            }
            return { ...item, data, price, stock };
        });
        const unavailable = shortages.filter((item) => item.hidden);
        if (unavailable.length) {
            const names = unavailable.map((item) => `“${item.title || "Sản phẩm"}”`).join(", ");
            return res.status(409).json({
                code: "product-unavailable",
                error: `${names} hiện đang tạm ẩn và không thể đặt hàng. Hãy chọn sản phẩm khác.`
            });
        }
        if (shortages.length) {
            const message = shortages.map((item) => item.available
                ? `“${item.title || "Một sản phẩm"}” chỉ còn ${item.available} sản phẩm`
                : `“${item.title || "Một sản phẩm"}” đã hết hàng`).join("; ");
            return res.status(409).json({
                code: "insufficient-stock",
                error: `${message}. Hãy giảm số lượng hoặc xóa sản phẩm đó khỏi giỏ.`,
                items: shortages
            });
        }
        const promotions = Array.isArray(promotionsSnapshot.data()?.items) ? promotionsSnapshot.data().items : [];
        const { subtotal, savings } = priceCart(cart, findPromotion(promotions, quote.promotionId));
        const totals = { subtotal, savings, tax: 0, shippingFee, total: subtotal - savings + shippingFee };
        return res.status(200).json({
            totals,
            deliveryZone: zone ? {
                id: zone.id,
                province: zone.province,
                district: zone.district,
                fee: zone.fee
            } : null,
            deliveryZonesConfigured: getEnabledDeliveryZones(deliverySnapshot.data()).length > 0,
            items: cart.map((item) => ({
                id: item.id,
                ...bouquet.normalize(item),
                title: String(item.data.title || "Sản phẩm").slice(0, 120),
                image: String(item.data.image || "").slice(0, 1000),
                quantity: item.quantity,
                price: item.price,
                stock: item.stock
            }))
        });
    } catch (error) {
        if (["invalid-promotion", "insufficient-stock", "product-unavailable", "delivery-zone-unavailable"].includes(error.code)) {
            return sendError(res, 409, error.code, error.message);
        }
        console.error("Order quote failed:", error.code || error.message);
        return sendError(res, 503, "order-service-unavailable", "Chưa thể kiểm tra giá đơn hàng. Vui lòng thử lại sau.");
    }
}

async function optionalAuthenticatedUser(req) {
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    return getAdminAuth().verifyIdToken(match[1], true);
}

const MAX_ORDER_NOTE_LENGTH = 500;

async function createOrder(req, res) {
    // Reject an over-long note instead of cutting it silently (the end often holds the delivery time).
    if (String(req.body?.orderNote || "").trim().length > MAX_ORDER_NOTE_LENGTH) {
        return sendError(res, 400, "note-too-long", `Ghi chú tối đa ${MAX_ORDER_NOTE_LENGTH} ký tự. Hãy rút gọn ghi chú rồi đặt lại.`);
    }
    if (quantityLimitError(res, req.body)) return;
    const checkout = validateCheckout(req.body);
    if (!checkout) {
        return sendError(res, 400, "invalid-checkout", "Thông tin đặt hàng hoặc danh sách sản phẩm không hợp lệ.");
    }

    try {
        const user = await optionalAuthenticatedUser(req);
        const db = getAdminFirestore();
        await releaseExpiredReservations(db);
        const idempotencyRef = db.collection("orderRequests").doc(checkout.idempotencyKey);
        const productRefs = checkout.items.map((item) => db.collection("products").doc(item.productId ?? item.id));
        const promotionsRef = db.collection("metadata").doc("activePromotions");
        const deliveryZonesRef = db.collection("metadata").doc("deliveryZones");
        const now = new Date();
        const requestHash = createHash("sha256").update(JSON.stringify({
            ...checkout, orderNote: String(req.body.orderNote || "").trim(), uid: user?.uid || ""
        })).digest("hex");

        const order = await db.runTransaction(async (transaction) => {
            const previousRequest = await transaction.get(idempotencyRef);
            if (previousRequest.exists) {
                if (previousRequest.data().uid !== (user?.uid || "")
                    || (previousRequest.data().requestHash && previousRequest.data().requestHash !== requestHash)) {
                    const error = new Error("Mã yêu cầu đã được dùng cho nội dung đặt hàng khác. Hãy kiểm tra đơn đã gửi.");
                    error.code = "idempotency-conflict";
                    throw error;
                }
                const previousOrderRef = db.collection("orders").doc(String(previousRequest.data().orderId || ""));
                const previousOrder = await transaction.get(previousOrderRef);
                if (!previousOrder.exists) {
                    const error = new Error("Yêu cầu đặt hàng này đã được xử lý nhưng đơn không còn tồn tại.");
                    error.code = "idempotency-conflict";
                    throw error;
                }
                const previousData = previousOrder.data();
                return {
                    id: previousOrder.id,
                    paymentReference: previousData.paymentReference,
                    subtotal: previousData.subtotal,
                    savings: previousData.savings,
                    shippingFee: Number(previousData.shippingFee) || 0,
                    total: previousData.total
                };
            }
            const scheduleError = deliveryScheduleError(checkout.deliveryDate, checkout.deliveryTime);
            if (scheduleError) {
                const error = new Error(scheduleError);
                error.code = "invalid-delivery-schedule";
                throw error;
            }

            const [productSnapshots, promotionSnapshot, deliveryZonesSnapshot] = await Promise.all([
                transaction.getAll(...productRefs),
                transaction.get(promotionsRef),
                transaction.get(deliveryZonesRef)
            ]);
            const { zone: deliveryZone, shippingFee } = resolveDeliveryZone(
                deliveryZonesSnapshot.data(),
                checkout.deliveryZoneId
            );

            const products = checkout.items.map((item, index) => {
                const snapshot = productSnapshots[index];
                if (!snapshot.exists) {
                    const error = new Error("Một sản phẩm không còn bán.");
                    error.code = "product-unavailable";
                    throw error;
                }
                const data = snapshot.data();
                if (data.status === "hidden") {
                    const error = new Error(`“${String(data.title || "Sản phẩm").slice(0, 120)}” hiện đang tạm ẩn và không thể đặt hàng.`);
                    error.code = "product-unavailable";
                    throw error;
                }
                const price = bouquet.price(toVndPrice(data.price), item.size);
                const stock = Number(data.quantity);
                const title = String(data.title || "Một sản phẩm");
                if (!Number.isFinite(price) || price <= 0) {
                    const error = new Error(`“${title}” hiện chưa có giá bán. Hãy bỏ sản phẩm này khỏi giỏ.`);
                    error.code = "product-unavailable";
                    throw error;
                }
                // One product can sit on several cart lines (different bouquet options): check the total.
                const demand = bouquet.demand(checkout.items, item.productId ?? item.id);
                if (!Number.isInteger(stock) || stock < demand) {
                    const available = Number.isInteger(stock) ? Math.max(0, stock) : 0;
                    const error = new Error(available
                        ? `“${title}” vừa có người mua, chỉ còn ${available} sản phẩm. Hãy giảm số lượng rồi đặt lại.`
                        : `“${title}” vừa hết hàng. Hãy bỏ sản phẩm này khỏi giỏ.`);
                    error.code = "insufficient-stock";
                    throw error;
                }
                return { ...item, ref: productRefs[index], data, price, stock };
            });

            const promotions = Array.isArray(promotionSnapshot.data()?.items)
                ? promotionSnapshot.data().items
                : [];
            const promotion = findPromotion(promotions, checkout.promotionId);
            const { subtotal, savings } = priceCart(products, promotion);
            const total = subtotal - savings + shippingFee;
            if (checkout.expectedTotals.subtotal !== subtotal
                || checkout.expectedTotals.savings !== savings
                || checkout.expectedTotals.tax !== 0
                || checkout.expectedTotals.shippingFee !== shippingFee
                || checkout.expectedTotals.total !== total) {
                const error = new Error("Giá hoặc ưu đãi vừa thay đổi. Hãy quay lại trang thanh toán để xem tổng tiền mới.");
                error.code = "price-changed";
                throw error;
            }
            const orderRef = db.collection("orders").doc();
            const paymentReference = paymentReferenceFor(checkout.idempotencyKey);
            const items = products.map((item) => ({
                id: item.id,
                ...bouquet.normalize(item),
                title: String(item.data.title || "Sản phẩm").slice(0, 120),
                image: String(item.data.image || "").slice(0, 1000),
                quantity: item.quantity,
                price: item.price,
                stock: item.stock
            }));
            const initialStatus = "Chờ xác nhận";
            const initialLocation = "Đơn hàng đã được gửi đến cửa hàng";
            const orderData = {
                uid: user?.uid || "",
                email: String(user?.email || "").slice(0, 254),
                customerName: checkout.customerName,
                phone: checkout.phone,
                address: checkout.address,
                recipientName: checkout.recipientName,
                recipientPhone: checkout.recipientPhone,
                customerIsRecipient: checkout.customerIsRecipient,
                deliveryDate: checkout.deliveryDate,
                deliveryTime: checkout.deliveryTime,
                deliveryZoneId: deliveryZone.id,
                deliveryProvince: deliveryZone.province,
                deliveryDistrict: deliveryZone.district,
                greetingCard: checkout.greetingCard,
                anonymousGreetingCard: checkout.anonymousGreetingCard,
                giftWrap: checkout.giftWrap,
                createdAt: FieldValue.serverTimestamp(),
                status: initialStatus,
                currentLocation: initialLocation,
                estimatedDelivery: "",
                trackingHistory: [{ status: initialStatus, location: initialLocation, estimatedDelivery: "", updatedAt: now.toISOString() }],
                subtotal,
                savings,
                tax: 0,
                shippingFee,
                total,
                paymentMethod: checkout.paymentMethod,
                paymentStatus: checkout.paymentMethod === "qr"
                    ? "Chờ xác minh thanh toán"
                    : checkout.paymentMethod === "vnpay" ? "chua_thanh_toan" : "Thanh toán khi nhận hàng",
                paymentReference,
                paidAt: "",
                paymentVerified: false,
                promotionId: promotion ? checkout.promotionId : "",
                orderNote: String(req.body.orderNote || "").trim(),
                items,
                inventoryReserved: true,
                inventoryState: "reserved",
                reservationExpiresAt: Timestamp.fromMillis(now.getTime() + (
                    checkout.paymentMethod === "qr" ? QR_RESERVATION_MS
                        : checkout.paymentMethod === "vnpay" ? VNPAY_RESERVATION_MS : COD_RESERVATION_MS
                ))
            };

            const reservedProducts = new Set();
            products.forEach((item) => {
                const productId = item.productId ?? item.id;
                if (reservedProducts.has(productId)) return;
                reservedProducts.add(productId);
                transaction.update(item.ref, { quantity: item.stock - bouquet.demand(checkout.items, productId) });
            });
            transaction.create(orderRef, orderData);
            transaction.create(idempotencyRef, {
                orderId: orderRef.id,
                requestHash,
                uid: user?.uid || "",
                createdAt: FieldValue.serverTimestamp()
            });
            return { ...orderData, id: orderRef.id, createdAt: now.toISOString() };
        });

        return res.status(201).json({ order: { id: order.id, paymentReference: order.paymentReference }, totals: {
            subtotal: order.subtotal,
            savings: order.savings,
            shippingFee: order.shippingFee,
            total: order.total
        } });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại rồi đặt hàng.");
        }
        if (["invalid-checkout", "invalid-delivery-schedule", "invalid-promotion", "insufficient-stock", "product-unavailable", "price-changed", "idempotency-conflict", "delivery-zone-unavailable"].includes(error.code)) {
            const status = ["invalid-checkout", "invalid-delivery-schedule"].includes(error.code) ? 400 : 409;
            return sendError(res, status, error.code, error.message);
        }
        console.error("Order creation failed:", error.code || error.message);
        return sendError(res, 503, "order-service-unavailable", "Chưa thể xác nhận đơn hàng. Vui lòng thử lại sau.");
    }
}

async function lookupOrder(req, res) {
    try {
        const db = getAdminFirestore();
        const limit = await checkOrderLookupLimit(db, req);
        if (!limit.allowed) {
            res.setHeader("Retry-After", String(limit.retryAfter));
            return sendError(res, 429, "rate-limited", "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau.");
        }

        const id = String(req.body?.id || "").trim().replace(/^#/, "");
        const phone = normalizePhone(req.body?.phone);
        if (!id || id.length > 128 || id.includes("/") || phone.length < 8 || phone.length > 15) {
            return sendError(res, 400, "invalid-argument", "Mã đơn hàng hoặc số điện thoại không hợp lệ.");
        }

        const snapshot = await db.collection("orders").doc(id).get();
        if (!snapshot.exists || normalizePhone(snapshot.get("phone")) !== phone) {
            return sendError(res, 404, "order-not-found", "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại.");
        }
        return res.status(200).json({ order: publicTrackingOrder(snapshot.id, snapshot.data()) });
    } catch (error) {
        console.error("Order lookup failed:", error.code || error.message);
        return sendError(res, 503, "order-service-unavailable", "Chưa thể tra cứu đơn hàng. Vui lòng thử lại sau.");
    }
}

// One public review per order. The id is derived from the order id so a second review of the same
// order collides, without listing order ids in the public reviews collection.
function reviewIdForOrder(orderId) {
    return createHash("sha256").update(`review:${orderId}`).digest("hex").slice(0, 40);
}

async function getOwnReview(req, res) {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId || orderId.length > 128 || orderId.includes("/")) return sendError(res, 400, "invalid-argument", "Mã đơn không hợp lệ.");
    try {
        const user = await optionalAuthenticatedUser(req);
        if (!user) return sendError(res, 401, "unauthenticated", "Đăng nhập để xem đánh giá của bạn.");
        const db = getAdminFirestore();
        const order = await db.collection("orders").doc(orderId).get();
        if (!order.exists || order.data().uid !== user.uid) return sendError(res, 404, "order-not-found", "Không tìm thấy đơn trong tài khoản.");
        const review = await db.collection("reviews").doc(reviewIdForOrder(orderId)).get();
        return res.status(200).json({ review: review.exists ? { ...review.data(), id: review.id,
            createdAt: serializeTimestamp(review.data().createdAt), orderId } : null });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn.");
        return sendError(res, 503, "review-unavailable", "Chưa tải được đánh giá. Hãy thử lại.");
    }
}

// Only the signed-in owner of a delivered order may review it. Products and the shown name come
// from the order, never from the browser.
async function submitReview(req, res) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return sendError(res, 401, "unauthenticated", "Đăng nhập tài khoản đã đặt đơn để gửi đánh giá.");
    const orderId = String(req.body?.orderId || "").trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();
    const photos = validateReviewPhotos(req.body?.photos);
    if (!photos) return sendError(res, 400, "invalid-photos", "Tối đa 3 ảnh JPEG đã tối ưu, mỗi ảnh không quá 120 KB và 1600px.");
    if (!orderId || orderId.length > 128 || orderId.includes("/")
        || !Number.isInteger(rating) || rating < 1 || rating > 5
        || !comment || comment.length > 1000) {
        return sendError(res, 400, "invalid-argument", "Hãy chọn số sao và nhập nhận xét (tối đa 1000 ký tự).");
    }

    let user;
    try {
        user = await getAdminAuth().verifyIdToken(match[1], true);
    } catch {
        return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
    }

    try {
        const db = getAdminFirestore();
        const orderRef = db.collection("orders").doc(orderId);
        const reviewRef = db.collection("reviews").doc(reviewIdForOrder(orderId));
        const review = await db.runTransaction(async (transaction) => {
            const [orderSnapshot, reviewSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(reviewRef)]);
            const order = orderSnapshot.exists ? orderSnapshot.data() : null;
            if (!order || !order.uid || order.uid !== user.uid) {
                const error = new Error("Không tìm thấy đơn hàng này trong tài khoản của bạn.");
                error.code = "order-not-found";
                throw error;
            }
            if (order.status !== "Đã giao") {
                const error = new Error("Chỉ có thể đánh giá đơn hàng đã giao.");
                error.code = "order-not-delivered";
                throw error;
            }
            if (reviewSnapshot.exists) {
                const error = new Error("Bạn đã đánh giá đơn hàng này rồi.");
                error.code = "already-reviewed";
                throw error;
            }
            const items = Array.isArray(order.items) ? order.items : [];
            const productIds = aggregateItems(items).map((item) => item.id).filter(Boolean).slice(0, 10);
            if (!productIds.length) {
                const error = new Error("Đơn hàng không có thông tin sản phẩm để gắn đánh giá.");
                error.code = "invalid-argument";
                throw error;
            }
            const name = String(order.customerName || "").trim().slice(0, 80);
            const data = {
                authorUid: user.uid,
                verifiedPurchase: true,
                moderationStatus: "pending",
                photoIds: photos.map((_, index) => `${reviewRef.id}_${index}`),
                productIds,
                productName: items.map((item) => String(item?.title || "")).filter(Boolean).join(", ").slice(0, 500) || "Sản phẩm hoa",
                // Customers cannot post under the shop's name.
                customerName: !name || /flower\s*flow|cửa hàng|quản trị|admin/i.test(name) ? "Khách hàng" : name,
                rating,
                comment,
                createdAt: FieldValue.serverTimestamp()
            };
            transaction.create(reviewRef, data);
            photos.forEach((bytes, index) => transaction.create(db.collection("reviewImages").doc(`${reviewRef.id}_${index}`), {
                reviewId: reviewRef.id, bytes, createdAt: FieldValue.serverTimestamp()
            }));
            return data;
        });
        return res.status(201).json({ review: { ...review, id: reviewRef.id, createdAt: new Date().toISOString() } });
    } catch (error) {
        if (["order-not-found", "order-not-delivered", "already-reviewed", "invalid-argument"].includes(error.code)) {
            const status = { "order-not-found": 404, "invalid-argument": 400 }[error.code] || 409;
            return sendError(res, status, error.code, error.message);
        }
        console.error("Review submission failed:", error.code || error.message);
        return sendError(res, 503, "review-service-unavailable", "Chưa thể gửi đánh giá. Vui lòng thử lại sau.");
    }
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST") {
        if (req.body?.action === "quote") return quoteOrder(req, res);
        if (req.body?.action === "lookup") return lookupOrder(req, res);
        if (req.body?.action === "review") return submitReview(req, res);
        if (req.body?.action === "review-get") return getOwnReview(req, res);
        return createOrder(req, res);
    }
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API đơn hàng chỉ chấp nhận phương thức GET hoặc POST.");
    }

    if (req.query?.action === "expire") {
        const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
        let authorized = Boolean(process.env.CRON_SECRET && match?.[1] === process.env.CRON_SECRET);
        if (!authorized && match?.[1]) {
            try {
                const claims = await getAdminAuth().verifyIdToken(match[1], true);
                authorized = claims.admin === true;
            } catch (error) {
                console.error("Reservation cleanup authentication failed:", error.code || error.message);
            }
        }
        if (!authorized) return sendError(res, 401, "unauthenticated", "Quyền dọn đơn hết hạn không hợp lệ.");
        try {
            const released = await expireReservations(getAdminFirestore());
            return res.status(200).json({ released });
        } catch (error) {
            console.error("Reservation cleanup failed:", error.code || error.message);
            return sendError(res, 503, "order-service-unavailable", "Chưa thể giải phóng tồn kho đơn hết hạn.");
        }
    }

    return sendError(res, 405, "method-not-allowed", "Tra cứu đơn hàng cần dùng phương thức POST.");
};

// Pure helpers, exported for unit tests.
module.exports.internals = {
    normalizePhone,
    aggregateItems,
    findPromotion,
    priceCart,
    validateCheckout,
    validateQuote,
    deliveryScheduleError,
    getVietnameseDateTime,
    getEnabledDeliveryZones,
    resolveDeliveryZone,
    DELIVERY_TIME_WINDOWS,
    paymentReferenceFor,
    publicTrackingOrder,
    reviewIdForOrder,
    expireReservations,
    aggregateItems,
    MAX_ORDER_NOTE_LENGTH,
    MAX_QUANTITY_PER_PRODUCT,
    VNPAY_RESERVATION_MS
};
