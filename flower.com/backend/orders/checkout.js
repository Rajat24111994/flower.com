// Đặt hàng: báo giá và tạo đơn (tính lại giá, kiểm tra kho, chống đặt trùng, giới hạn tạo đơn).
const bouquet = require("../../js/catalog/bouquet-options.js");
const { createHash, createHmac } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAdminFirestore, sendError } = require("../shared/firebase-admin");
const bouquetWrapping = require("../../js/catalog/bouquet-wrapping.js");
const { MAX_QUANTITY_PER_PRODUCT, QR_RESERVATION_MS, VNPAY_RESERVATION_MS, COD_RESERVATION_MS, MAX_ORDER_NOTE_LENGTH } = require("./config");
const { normalizePhone, deliveryScheduleError, validateCheckout, validateQuote } = require("./validation");
const { getEnabledDeliveryZones, resolveDeliveryZone, calculateCustomBouquets, getProductSaleType, getProductPrice, findPromotion, priceCart, paymentReferenceFor } = require("./pricing");
const { releaseExpiredReservations } = require("./reservations");
const { optionalAuthenticatedUser } = require("./tracking");

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
        const [products, promotionsSnapshot, deliverySnapshot, wrappingSnapshot] = await Promise.all([
            db.getAll(...productRefs),
            db.collection("metadata").doc("activePromotions").get(),
            db.collection("metadata").doc("deliveryZones").get(),
            db.collection("metadata").doc("bouquetWrapping").get()
        ]);
        const { zone, shippingFee } = resolveDeliveryZone(deliverySnapshot.data(), quote.deliveryZoneId);
        // Report every product that cannot be sold in the asked quantity, with what is left, so the
        // checkout can tell the customer exactly what to change.
        const shortages = [];
        const cart = quote.items.map((item, index) => {
            const snapshot = products[index];
            const data = snapshot.exists ? snapshot.data() : {};
            const price = getProductPrice(data);
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
        const customBouquets = calculateCustomBouquets(cart, wrappingSnapshot.data()?.tiers);
        const wrappingFee = customBouquets.reduce((sum, item) => sum + item.wrappingFee, 0);
        const totals = { subtotal, savings, tax: 0, wrappingFee, shippingFee, total: subtotal - savings + wrappingFee + shippingFee };
        return res.status(200).json({
            totals,
            customBouquets,
            deliveryZone: zone ? {
                id: zone.id,
                province: zone.province,
                district: zone.district,
                fee: zone.fee
            } : null,
            deliveryZonesConfigured: getEnabledDeliveryZones(deliverySnapshot.data()).length > 0,
            items: cart.map((item) => ({
                id: item.id,
                productId: item.productId ?? item.id,
                title: String(item.data.title || "Sản phẩm").slice(0, 120),
                image: String(item.data.image || "").slice(0, 1000),
                saleType: getProductSaleType(item.data),
                unit: getProductSaleType(item.data) === "flower" ? "cành" : "bó",
                priceUpdatedAt: getProductSaleType(item.data) === "flower" ? item.data.priceUpdatedAt : "",
                quantity: item.quantity,
                price: item.price,
                stock: item.stock,
                customBouquetId: item.customBouquetId || "",
                size: item.size || "",
                color: item.color || "",
                cardMessage: item.cardMessage || "",
                personalNote: item.personalNote || ""
            }))
        });
    } catch (error) {
        if (["invalid-promotion", "insufficient-stock", "product-unavailable", "delivery-zone-unavailable", "invalid-custom-bouquet", "bouquet-quantity-limit", "bouquet-wrapping-unavailable"].includes(error.code)) {
            return sendError(res, 409, error.code, error.message);
        }
        console.error("Order quote failed:", error.code || "unknown");
        return sendError(res, 503, "order-service-unavailable", "Chưa thể kiểm tra giá đơn hàng. Vui lòng thử lại sau.");
    }
}

// Commit quotas atomically with stock. A repeated idempotency key does not consume a slot.
function creationLimitRefs(db, req, user, phone) {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!ip || ip.length > 64 || !secret) throw new Error("Trusted order source unavailable");
    return [["ip", ip, 5], ["phone", normalizePhone(phone), 3], ...(user ? [["account", user.uid, 5]] : [])]
        .map(([type, value, maximum]) => ({ maximum, ref: db.collection("orderCreationLimits").doc(
            createHmac("sha256", secret).update(`${type}:${value}`).digest("hex")) }));
}

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
        const creationLimits = creationLimitRefs(db, req, user, checkout.phone);
        const idempotencyRef = db.collection("orderRequests").doc(checkout.idempotencyKey);
        const productRefs = checkout.items.map((item) => db.collection("products").doc(item.productId ?? item.id));
        const promotionsRef = db.collection("metadata").doc("activePromotions");
        const deliveryZonesRef = db.collection("metadata").doc("deliveryZones");
        const bouquetWrappingRef = db.collection("metadata").doc("bouquetWrapping");
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
                    wrappingFee: Number(previousData.wrappingFee) || 0,
                    total: previousData.total
                };
            }
            const limitSnapshots = await transaction.getAll(...creationLimits.map(limit => limit.ref));
            const limitUpdates = creationLimits.map((limit, index) => {
                const record = limitSnapshots[index].data() || {};
                const until = record.expiresAt?.toMillis?.() || 0;
                const count = until > now.getTime() ? Number(record.count) || 0 : 0;
                if (count >= limit.maximum) throw Object.assign(new Error("Bạn đã gửi nhiều đơn trong thời gian ngắn. Vui lòng thử lại sau."), {
                    code: "order-rate-limited", retryAfter: Math.max(1, Math.ceil((until - now.getTime()) / 1000))
                });
                return { ref: limit.ref, count: count + 1, expiresAt: Timestamp.fromMillis(until > now.getTime() ? until : now.getTime() + 15 * 60 * 1000) };
            });
            if (!user && checkout.items.some(item => bouquet.demand(checkout.items, item.productId ?? item.id) > 5)) {
                throw Object.assign(new Error("Khách chưa đăng nhập đặt tối đa 5 sản phẩm mỗi loại trong một đơn. Hãy đăng nhập để đặt số lượng lớn hơn."), { code: "guest-quantity-limit" });
            }
            const scheduleError = deliveryScheduleError(checkout.deliveryDate, checkout.deliveryTime);
            if (scheduleError) {
                const error = new Error(scheduleError);
                error.code = "invalid-delivery-schedule";
                throw error;
            }

            const [productSnapshots, promotionSnapshot, deliveryZonesSnapshot, bouquetWrappingSnapshot] = await Promise.all([
                transaction.getAll(...productRefs),
                transaction.get(promotionsRef),
                transaction.get(deliveryZonesRef),
                transaction.get(bouquetWrappingRef)
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
                const price = getProductPrice(data);
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
            const customBouquets = calculateCustomBouquets(products, bouquetWrappingSnapshot.data()?.tiers);
            const wrappingFee = customBouquets.reduce((sum, item) => sum + item.wrappingFee, 0);
            const total = subtotal - savings + wrappingFee + shippingFee;
            if (checkout.expectedTotals.subtotal !== subtotal
                || checkout.expectedTotals.savings !== savings
                || checkout.expectedTotals.tax !== 0
                || checkout.expectedTotals.shippingFee !== shippingFee
                || (checkout.expectedTotals.wrappingFee ?? 0) !== wrappingFee
                || checkout.expectedTotals.total !== total) {
                const error = new Error("Giá hoặc ưu đãi vừa thay đổi. Hãy quay lại trang thanh toán để xem tổng tiền mới.");
                error.code = "price-changed";
                throw error;
            }
            const orderRef = db.collection("orders").doc();
            const paymentReference = paymentReferenceFor(checkout.idempotencyKey);
            const items = products.map((item) => ({
                id: item.id,
                productId: item.productId ?? item.id,
                title: String(item.data.title || "Sản phẩm").slice(0, 120),
                image: String(item.data.image || "").slice(0, 1000),
                saleType: getProductSaleType(item.data),
                unit: getProductSaleType(item.data) === "flower" ? "cành" : "bó",
                priceUpdatedAt: getProductSaleType(item.data) === "flower" ? item.data.priceUpdatedAt : "",
                quantity: item.quantity,
                price: item.price,
                stock: item.stock,
                customBouquetId: item.customBouquetId || "",
                size: item.size || "",
                color: item.color || "",
                cardMessage: item.cardMessage || "",
                personalNote: item.personalNote || ""
            }));
            const initialStatus = "Chờ xác nhận";
            const initialLocation = "Đơn hàng đã được gửi đến cửa hàng";
            const orderData = {
                orderType: products.some((item) => getProductSaleType(item.data) === "flower") ? "custom_bouquet" : "ready_made",
                uid: user?.uid || "",
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
                wrappingFee,
                customBouquets,
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
            for (const limit of limitUpdates) transaction.set(limit.ref, { count: limit.count, expiresAt: limit.expiresAt });
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
            wrappingFee: order.wrappingFee,
            shippingFee: order.shippingFee,
            total: order.total
        } });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại rồi đặt hàng.");
        }
        if (error.code === "order-rate-limited") { res.setHeader("Retry-After", String(error.retryAfter)); return sendError(res, 429, error.code, error.message); }
        if (error.code === "guest-quantity-limit") return sendError(res, 400, error.code, error.message);
        if (["invalid-checkout", "invalid-delivery-schedule", "invalid-promotion", "insufficient-stock", "product-unavailable", "price-changed", "idempotency-conflict", "delivery-zone-unavailable", "invalid-custom-bouquet", "bouquet-quantity-limit", "bouquet-wrapping-unavailable"].includes(error.code)) {
            const status = ["invalid-checkout", "invalid-delivery-schedule"].includes(error.code) ? 400 : 409;
            return sendError(res, status, error.code, error.message);
        }
        console.error("Order creation failed:", error.code || "unknown");
        return sendError(res, 503, "order-service-unavailable", "Chưa thể xác nhận đơn hàng. Vui lòng thử lại sau.");
    }
}

module.exports = { quantityLimitError, quoteOrder, creationLimitRefs, createOrder };
