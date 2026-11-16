// Kiểm tra và chuẩn hóa dữ liệu khách gửi lên: số điện thoại, lịch giao, giỏ hàng, ngày ưu đãi.
const bouquet = require("../../js/catalog/bouquet-options.js");
const { MAX_QUANTITY_PER_PRODUCT, DELIVERY_TIME_WINDOWS, DELIVERY_TIME_ZONE } = require("./config");

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
    if (expectedTotals.wrappingFee !== undefined
        && (!Number.isSafeInteger(expectedTotals.wrappingFee) || expectedTotals.wrappingFee < 0)) return null;

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
        const customBouquetId = String(item?.customBouquetId || "");
        if (customBouquetId && !/^[A-Za-z0-9_-]{1,80}$/.test(customBouquetId)) return null;
        normalizedItems.push({ id, quantity, ...(customBouquetId ? { customBouquetId } : {}), ...options });
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
        const customBouquetId = String(item?.customBouquetId || "");
        if (customBouquetId && !/^[A-Za-z0-9_-]{1,80}$/.test(customBouquetId)) return null;
        items.push({ id, quantity, ...(customBouquetId ? { customBouquetId } : {}), ...options });
    }
    return { items, promotionId, deliveryZoneId };
}

function isValidPromotionDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function vietnameseDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

module.exports = { normalizePhone, getVietnameseDateTime, deliveryScheduleError, validateCheckout, validateQuote, isValidPromotionDate, vietnameseDate };
