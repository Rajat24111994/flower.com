const { createHash, createHmac } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError } = require("../lib/firebase-admin");
// Same price reading as the shop pages (whole VND, old USD prices converted), so both agree.
const { toVndPrice } = require("../product-store.js");

const MAX_QUANTITY_PER_PRODUCT = 50;
const QR_RESERVATION_MS = 30 * 60 * 1000;
const COD_RESERVATION_MS = 24 * 60 * 60 * 1000;
const ORDER_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const ORDER_LOOKUP_MAX_ATTEMPTS = 20;

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function aggregateItems(items) {
    const quantities = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
        const id = String(item?.id ?? "");
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
        const shouldRestoreStock = order.status !== "Đã giao";
        const productRefs = shouldRestoreStock
            ? items.map((item) => db.collection("products").doc(item.id))
            : [];
        const productSnapshots = [];
        for (const productRef of productRefs) productSnapshots.push(await transaction.get(productRef));

        const expiredAt = new Date(now.toMillis()).toISOString();
        const status = shouldRestoreStock ? "Đã hủy" : order.status;
        const location = shouldRestoreStock ? "Đơn hàng hết thời hạn giữ sản phẩm" : order.currentLocation || "";
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
            ...(order.paymentMethod === "qr" && order.paymentVerified !== true
                ? { paymentStatus: "Hết hạn chờ thanh toán" }
                : {}),
            trackingUpdatedAt: Timestamp.fromMillis(now.toMillis()),
            trackingHistory: [...(Array.isArray(order.trackingHistory) ? order.trackingHistory : []), {
                status,
                location,
                estimatedDelivery: "",
                updatedAt: expiredAt
            }]
        });
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
        } : {}),
        privacyLimited: true
    };
}

function awaitsQrTransfer(data) {
    return data.paymentMethod === "qr" && data.paymentVerified !== true && (data.status || "Chờ xác nhận") === "Chờ xác nhận";
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
    const recipientName = String(body.recipientName || customerName).trim();
    const recipientPhone = String(body.recipientPhone || phone).trim();
    const deliveryDate = String(body.deliveryDate || "").trim();
    const deliveryTime = String(body.deliveryTime || "").trim();
    const greetingCard = String(body.greetingCard || "").trim();
    const giftWrap = String(body.giftWrap || "none");
    const paymentMethod = String(body.paymentMethod || "");
    const promotionId = String(body.promotionId || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const items = body.items;
    const expectedTotals = body.expectedTotals;
    const deliveryDateTimestamp = Date.parse(`${deliveryDate}T00:00:00Z`);
    const todayUtc = new Date().toISOString().slice(0, 10);

    if (!customerName || customerName.length > 100
        || !address || address.length > 500
        || normalizePhone(phone).length < 8 || normalizePhone(phone).length > 15
        || recipientName.length > 120
        || normalizePhone(recipientPhone).length < 8 || normalizePhone(recipientPhone).length > 15
        || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
        || !Number.isFinite(deliveryDateTimestamp)
        || new Date(deliveryDateTimestamp).toISOString().slice(0, 10) !== deliveryDate
        || deliveryDate < todayUtc
        || !["08:00–12:00", "12:00–16:00", "16:00–20:00"].includes(deliveryTime)
        || greetingCard.length > 300
        || !["none", "pastel", "classic"].includes(giftWrap)
        || !["qr", "cod"].includes(paymentMethod)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
        || promotionId.length > 100
        || !expectedTotals
        || !["subtotal", "savings", "tax", "total"].every((key) => (
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
        normalizedItems.push({ id, quantity });
    }

    return {
        customerName,
        phone,
        address,
        recipientName,
        recipientPhone,
        deliveryDate,
        deliveryTime,
        greetingCard,
        giftWrap,
        paymentMethod,
        promotionId,
        idempotencyKey,
        paymentReference: String(body.paymentReference || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50),
        expectedTotals,
        items: normalizedItems
    };
}

function validateQuote(body = {}) {
    const promotionId = String(body.promotionId || "").trim();
    if (promotionId.length > 100 || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return null;
    const seenIds = new Set();
    const items = [];
    for (const item of body.items) {
        const id = String(item?.id ?? "").trim();
        const quantity = Number(item?.quantity);
        if (!id || id.length > 128 || id.includes("/") || seenIds.has(id)
            || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_PRODUCT) return null;
        seenIds.add(id);
        items.push({ id, quantity });
    }
    return { items, promotionId };
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
    const savings = Math.min(subtotal, Math.round(items.reduce((sum, item) => sum + (promotion && (appliesToAll || eligibleIds.has(String(item.id)))
        ? item.price * item.quantity * discountPercent / 100
        : 0), 0)));
    return { subtotal, savings, tax: 0, total: subtotal - savings };
}

async function quoteOrder(req, res) {
    const quote = validateQuote(req.body);
    if (!quote) return sendError(res, 400, "invalid-checkout", "Danh sách sản phẩm không hợp lệ.");
    try {
        const db = getAdminFirestore();
        await releaseExpiredReservations(db);
        const productRefs = quote.items.map((item) => db.collection("products").doc(item.id));
        const [products, promotionsSnapshot] = await Promise.all([
            db.getAll(...productRefs),
            db.collection("metadata").doc("activePromotions").get()
        ]);
        // Report every product that cannot be sold in the asked quantity, with what is left, so the
        // checkout can tell the customer exactly what to change.
        const shortages = [];
        const cart = quote.items.map((item, index) => {
            const snapshot = products[index];
            const data = snapshot.exists ? snapshot.data() : {};
            const price = toVndPrice(data.price);
            const stock = Number(data.quantity);
            if (!snapshot.exists || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < item.quantity) {
                shortages.push({
                    id: item.id,
                    title: String(data.title || "").slice(0, 120),
                    available: snapshot.exists && Number.isInteger(stock) && Number.isFinite(price) && price > 0 ? Math.max(0, stock) : 0
                });
            }
            return { ...item, data, price, stock };
        });
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
        return res.status(200).json({
            totals: { subtotal, savings, tax: 0, total: subtotal - savings },
            items: cart.map((item) => ({
                id: item.id,
                title: String(item.data.title || "Sản phẩm").slice(0, 120),
                image: String(item.data.image || "").slice(0, 1000),
                quantity: item.quantity,
                price: item.price,
                stock: item.stock
            }))
        });
    } catch (error) {
        if (["invalid-promotion", "insufficient-stock", "product-unavailable"].includes(error.code)) {
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
    const checkout = validateCheckout(req.body);
    if (!checkout) {
        return sendError(res, 400, "invalid-checkout", "Thông tin đặt hàng hoặc danh sách sản phẩm không hợp lệ.");
    }

    try {
        const user = await optionalAuthenticatedUser(req);
        const db = getAdminFirestore();
        await releaseExpiredReservations(db);
        const idempotencyRef = db.collection("orderRequests").doc(checkout.idempotencyKey);
        const productRefs = checkout.items.map((item) => db.collection("products").doc(item.id));
        const promotionsRef = db.collection("metadata").doc("activePromotions");
        const now = new Date();

        const order = await db.runTransaction(async (transaction) => {
            const previousRequest = await transaction.get(idempotencyRef);
            if (previousRequest.exists) {
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
                    subtotal: previousData.subtotal,
                    savings: previousData.savings,
                    total: previousData.total
                };
            }

            const [productSnapshots, promotionSnapshot] = await Promise.all([
                transaction.getAll(...productRefs),
                transaction.get(promotionsRef)
            ]);

            const products = checkout.items.map((item, index) => {
                const snapshot = productSnapshots[index];
                if (!snapshot.exists) {
                    const error = new Error("Một sản phẩm không còn bán.");
                    error.code = "product-unavailable";
                    throw error;
                }
                const data = snapshot.data();
                const price = toVndPrice(data.price);
                const stock = Number(data.quantity);
                if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < item.quantity) {
                    const error = new Error("Sản phẩm không đủ tồn kho hoặc có giá chưa hợp lệ.");
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
            const total = subtotal - savings;
            if (checkout.expectedTotals.subtotal !== subtotal
                || checkout.expectedTotals.savings !== savings
                || checkout.expectedTotals.tax !== 0
                || checkout.expectedTotals.total !== total) {
                const error = new Error("Giá hoặc tồn kho vừa thay đổi. Hãy tải lại báo giá trước khi xác nhận.");
                error.code = "price-changed";
                throw error;
            }
            const orderRef = db.collection("orders").doc();
            const paymentReference = checkout.paymentReference || `FF${orderRef.id.slice(-12).toUpperCase()}`;
            const items = products.map((item) => ({
                id: item.id,
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
                deliveryDate: checkout.deliveryDate,
                deliveryTime: checkout.deliveryTime,
                greetingCard: checkout.greetingCard,
                giftWrap: checkout.giftWrap,
                createdAt: FieldValue.serverTimestamp(),
                status: initialStatus,
                currentLocation: initialLocation,
                estimatedDelivery: "",
                trackingHistory: [{ status: initialStatus, location: initialLocation, estimatedDelivery: "", updatedAt: now.toISOString() }],
                subtotal,
                savings,
                tax: 0,
                total,
                paymentMethod: checkout.paymentMethod,
                paymentStatus: checkout.paymentMethod === "qr" ? "Chờ xác minh thanh toán" : "Thanh toán khi nhận hàng",
                paymentReference,
                paidAt: "",
                paymentVerified: false,
                promotionId: promotion ? checkout.promotionId : "",
                orderNote: String(req.body.orderNote || "").trim(),
                items,
                inventoryReserved: true,
                inventoryState: "reserved",
                reservationExpiresAt: Timestamp.fromMillis(now.getTime() + (
                    checkout.paymentMethod === "qr" ? QR_RESERVATION_MS : COD_RESERVATION_MS
                ))
            };

            products.forEach((item) => transaction.update(item.ref, { quantity: item.stock - item.quantity }));
            transaction.create(orderRef, orderData);
            transaction.create(idempotencyRef, {
                orderId: orderRef.id,
                uid: user?.uid || "",
                createdAt: FieldValue.serverTimestamp()
            });
            return { ...orderData, id: orderRef.id, createdAt: now.toISOString() };
        });

        return res.status(201).json({ order: { id: order.id }, totals: {
            subtotal: order.subtotal,
            savings: order.savings,
            total: order.total
        } });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại rồi đặt hàng.");
        }
        if (["invalid-checkout", "invalid-promotion", "insufficient-stock", "product-unavailable", "price-changed", "idempotency-conflict"].includes(error.code)) {
            const status = error.code === "invalid-checkout" ? 400 : 409;
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

// Only the signed-in owner of a delivered order may review it. Products and the shown name come
// from the order, never from the browser.
async function submitReview(req, res) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return sendError(res, 401, "unauthenticated", "Đăng nhập tài khoản đã đặt đơn để gửi đánh giá.");
    const orderId = String(req.body?.orderId || "").trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();
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
                productIds,
                productName: items.map((item) => String(item?.title || "")).filter(Boolean).join(", ").slice(0, 500) || "Sản phẩm hoa",
                // Customers cannot post under the shop's name.
                customerName: !name || /flower\s*flow|cửa hàng|quản trị|admin/i.test(name) ? "Khách hàng" : name,
                rating,
                comment,
                createdAt: FieldValue.serverTimestamp()
            };
            transaction.create(reviewRef, data);
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
    publicTrackingOrder,
    reviewIdForOrder,
    MAX_ORDER_NOTE_LENGTH
};
