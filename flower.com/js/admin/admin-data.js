import { registerAdminFunctions } from "./admin-state.js";
import { normalizeOrderStatus } from "../order/order-status.js?v=2";
import { isOrderPaid } from "./admin-analytics.js?v=2";

function moneyFormat(value) {
   return new Intl.NumberFormat("vi-VN", {
       style: "currency",
       currency: "VND"
   }).format(Number(value || 0));
}

// How the customer pays, shown next to the payment status (#48).
function getPaymentMethodLabel(order) {
   if (order.paymentMethod === "qr") return "Chuyển khoản QR";
   if (order.paymentMethod === "cod") return "Tiền mặt khi nhận hàng (COD)";
   if (order.paymentMethod === "vnpay") return "VNPay";
   return "Chưa rõ";
}

function getPaymentDisplayStatus(order) {
   if (order.paymentRefunded === true) return "Đã hoàn tiền";
   if (order.paymentMethod === "qr") {
       if (order.paymentVerified === true) return "Đã thanh toán (đã đối soát)";
       return order.paymentStatus === "Hết hạn chờ thanh toán" ? order.paymentStatus : "Chờ cửa hàng xác minh";
   }
   if (order.paymentMethod === "vnpay") {
       if (order.latePayment === true) return "Thanh toán muộn – cần kiểm tra";
       return ({
           chua_thanh_toan: "Chưa thanh toán VNPay",
           da_thanh_toan: "Đã thanh toán VNPay",
           that_bai: "Thanh toán VNPay thất bại"
       })[order.paymentStatus] || "Chưa xác nhận VNPay";
   }
   return order.paymentStatus || (order.paymentMethod === "cod" ? "Thanh toán khi nhận hàng" : "Chưa xác nhận");
}

function isOrderDelivered(order) {
   return normalizeOrderStatus(order.status) === "Đã giao";
}

function getRevenueOrders(orders) {
   return orders.filter((order) => isOrderDelivered(order) && isOrderPaid(order) && order.paymentRefunded !== true);
}

async function ensureStorage() {
   await FlowerInventory.initialize();
}

function readLegacyCategories() {
   return window.FlowerSafeStorage.readJson(STORAGE_KEYS.categories, {
       fallback: [],
       validate: (value) => Array.isArray(value) && value.every((category) => typeof category === "string"),
       throwOnError: true
   });
}

function cacheCategories(categories) {
   categoriesCache = categories;
   try {
       window.FlowerSafeStorage.writeJson(STORAGE_KEYS.categories, categories);
   } catch (error) {
       console.warn("Không lưu được bản sao phân loại trên thiết bị:", error);
   }
}

// Loads categories from Firestore; on first run, uploads the ones this browser had saved locally.
async function loadCategories() {
   const categories = await FlowerInventory.initializeCategories(readLegacyCategories());
   cacheCategories(categories);
   return categories;
}

function getProducts() {
    return FlowerInventory.readProducts();
}

function getCategories() {
   const storedCategories = categoriesCache;
   const productCategories = getProducts().map((product) => product.category);
   return [...new Set(
       [...(Array.isArray(storedCategories) ? storedCategories : []), ...productCategories]
           .map((category) => String(category || "").trim())
           .filter(Boolean)
   )].sort((left, right) => left.localeCompare(right, "vi"));
}

function saveCategories(categories) {
   const normalizedCategories = [...new Set(
       categories.map((category) => String(category || "").trim()).filter(Boolean)
   )];
   const previousCategories = categoriesCache;
   cacheCategories(normalizedCategories);
   window.FlowerOrderStore.saveCategories(normalizedCategories).catch((error) => {
       console.error("Không thể lưu phân loại lên Firestore:", error);
       cacheCategories(previousCategories);
       alert("Chưa thể lưu phân loại lên hệ thống. Hãy thử lại sau.");
       if (main.querySelector(".panel h2")?.textContent === "Quản lý phân loại") renderCategoriesTab();
   });
}

function getOffers() {
   return window.FlowerSafeStorage.readJson(STORAGE_KEYS.offers, {
       fallback: [],
       validate: (value) => Array.isArray(value)
           && value.every((offer) => offer && typeof offer === "object" && !Array.isArray(offer))
   });
}

function cacheOffers(offers) {
   window.FlowerSafeStorage.writeJson(STORAGE_KEYS.offers, offers);
}

// change(latestOffers) runs against the newest server copy, not this browser's cache.
async function updateOffers(change) {
   cacheOffers(await window.FlowerOrderStore.updatePromotions(change));
}

function getOrders() {
   return [...ordersCache];
}

function getReviews() {
   return [...reviewsCache];
}

// Customer messages are the notes left on orders at checkout.
function getMessages() {
   const orderMessages = ordersCache
       .filter((order) => String(order.orderNote || "").trim() && !order.orderNoteArchivedAt)
       .map((order) => ({
           id: String(order.id),
           source: "order",
           customerName: order.customerName,
           phone: order.phone,
           subject: `Lời nhắn kèm đơn #${order.id}`,
           message: order.orderNote,
           createdAt: order.createdAt,
           reply: order.orderNoteReply || "",
           completedAt: order.orderNoteCompletedAt || ""
       }));
   return [...orderMessages, ...messagesCache].sort(
       (first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0)
   );
}

// Firestore calls can wait forever when the browser cannot reach Firestore (writes and
// transactions are queued until it is back). Startup steps give up after a while instead.
function withTimeout(promise, label, ms = 15000) {
   let timer;
   return Promise.race([
       promise,
       new Promise((_, reject) => {
           timer = setTimeout(() => reject(new Error(`${label}: quá ${ms / 1000} giây chưa phản hồi (có thể đang mất kết nối Firestore).`)), ms);
       })
   ]).finally(() => clearTimeout(timer));
}


registerAdminFunctions({ moneyFormat, getPaymentMethodLabel, getPaymentDisplayStatus, isOrderDelivered, getRevenueOrders, ensureStorage, readLegacyCategories, cacheCategories, loadCategories, getProducts, getCategories, saveCategories, getOffers, cacheOffers, updateOffers, getOrders, getReviews, getMessages, withTimeout });
