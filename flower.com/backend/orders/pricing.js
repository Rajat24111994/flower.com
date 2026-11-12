// Tính tiền phía máy chủ: giá sản phẩm, ưu đãi, phí giao theo khu vực, phí gói bó tự chọn.
const bouquet = require("../../js/catalog/bouquet-options.js");
// Cùng cách đọc giá với trang cửa hàng (VND nguyên, giá USD cũ được đổi), để hai bên luôn khớp.
const { toVndPrice } = require("../../js/catalog/product-store.js");
const bouquetWrapping = require("../../js/catalog/bouquet-wrapping.js");
const { isValidPromotionDate, vietnameseDate } = require("./validation");

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

function calculateCustomBouquets(items, tiers) {
    const groups = new Map();
    for (const item of items) {
        const isFlower = getProductSaleType(item.data) === "flower";
        const bouquetId = item.customBouquetId || "";
        if (isFlower !== Boolean(bouquetId)) {
            const error = new Error("Mỗi cành hoa phải thuộc một bó tùy chỉnh riêng; sản phẩm làm sẵn không thể ghép vào bó.");
            error.code = "invalid-custom-bouquet";
            throw error;
        }
        if (!bouquetId) continue;
        const group = groups.get(bouquetId) || { id: bouquetId, stemCount: 0 };
        group.stemCount += item.quantity;
        if (group.stemCount > bouquetWrapping.MAX_STEMS_PER_BOUQUET) {
            const error = new Error(`Mỗi bó tùy chỉnh tối đa ${bouquetWrapping.MAX_STEMS_PER_BOUQUET} cành.`);
            error.code = "bouquet-quantity-limit";
            throw error;
        }
        groups.set(bouquetId, group);
    }
    if (groups.size && !bouquetWrapping.normalizeTiers(tiers)) {
        const error = new Error("Cửa hàng chưa cấu hình bậc phí bó hoa. Vui lòng liên hệ cửa hàng.");
        error.code = "bouquet-wrapping-unavailable";
        throw error;
    }
    return [...groups.values()].map((group) => ({
        ...group,
        wrappingFee: bouquetWrapping.feeForStemCount(tiers, group.stemCount)
    }));
}

function getProductSaleType(data) {
    return data.saleType === "flower" ? "flower" : "ready_made";
}

function getProductPrice(data, now = new Date()) {
    return toVndPrice(data.price);
}

function aggregateItems(items) {
    const quantities = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
        const id = String(item?.productId ?? item?.id ?? "");
        quantities.set(id, (quantities.get(id) || 0) + Math.max(1, Number(item?.quantity) || 1));
    });
    return Array.from(quantities, ([id, quantity]) => ({ id, quantity }));
}

// Transfer content the shop matches bank statements against. Computed here from the request's
// unique idempotency key (the same formula checkout.html uses for the QR it shows), never taken
// from the browser, so nobody can reuse another order's content.
function paymentReferenceFor(idempotencyKey) {
    return `FF${String(idempotencyKey).replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

// The active promotion a checkout asked for, or null when it asked for none. Throws
// "invalid-promotion" for an unknown, inactive or malformed one.
function findPromotion(promotions, promotionId, now = new Date()) {
    if (!promotionId) return null;
    const promotion = (Array.isArray(promotions) ? promotions : [])
        .find((item) => String(item.id) === String(promotionId) && item.active === true);
    if (!promotion) {
        const error = new Error("Ưu đãi đã hết hạn hoặc không hợp lệ. Hãy tải lại trang thanh toán.");
        error.code = "invalid-promotion";
        throw error;
    }
    const discountPercent = Number(promotion.discountPercent);
    const today = vietnameseDate(now);
    const startDate = promotion.startDate || "";
    const endDate = promotion.endDate || "";
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100
        || (startDate && !isValidPromotionDate(startDate))
        || (endDate && !isValidPromotionDate(endDate))
        || (startDate && endDate && startDate > endDate)
        || (startDate && today < startDate)
        || (endDate && today > endDate)) {
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

module.exports = { getEnabledDeliveryZones, resolveDeliveryZone, calculateCustomBouquets, getProductSaleType, getProductPrice, aggregateItems, paymentReferenceFor, findPromotion, priceCart };
