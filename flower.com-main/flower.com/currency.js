// Every price is a whole number of VND (450000 = 450.000 ₫).
const VND_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
let trustedPromotions = [];

function formatVnd(amount) {
  return VND_FORMATTER.format(Math.round(Number(amount) || 0));
}

// Before v0.2 prices were stored in USD (for example 73.99). A cart or wishlist saved back then
// still holds those numbers: convert them once, rounded to 1.000 ₫ like the catalog migration.
// No flower costs less than 1.000 ₫, so any smaller price can only be an old USD price.
const LEGACY_USD_TO_VND = 25949.123093;

function toVndPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return NaN;
  return price > 0 && price < 1000
    ? Math.round((price * LEGACY_USD_TO_VND) / 1000) * 1000
    : Math.round(price);
}

(function convertSavedPricesToVnd() {
  const storage = typeof window !== "undefined" ? window.FlowerSafeStorage : null;
  if (!storage?.readJson) return;
  ["cart", "wish"].forEach((key) => {
    const items = storage.readJson(key, { fallback: null, validate: Array.isArray });
    if (!Array.isArray(items) || !items.some((item) => Number(item?.price) > 0 && Number(item.price) < 1000)) return;
    storage.writeJson(key, items.map((item) => (item && typeof item === "object"
      ? { ...item, price: toVndPrice(item.price) }
      : item)));
  });
})();

function promotionAppliesToAllProducts(promotion) {
  return promotion.allProducts === true;
}

function getAvailableCartPromotions(cart) {
  return trustedPromotions.filter((promotion) => {
    const percent = Number(promotion.discountPercent);
    const appliesToAllProducts = promotionAppliesToAllProducts(promotion);
    return promotion.active
      && (appliesToAllProducts || Array.isArray(promotion.productIds))
      && Number.isFinite(percent)
      && percent > 0
      && percent <= 100
      && (appliesToAllProducts
        || promotion.productIds.some((id) => cart.some((product) => String(product.id) === String(id))));
  });
}

function setTrustedPromotions(promotions) {
  trustedPromotions = Array.isArray(promotions) ? promotions : [];
}

function calculateCartTotals(cart, promotionId = window.FlowerSafeStorage.readText("flowerSelectedPromotion", "")) {
  const selectedPromotion = getAvailableCartPromotions(cart).find(
    (promotion) => String(promotion.id) === String(promotionId || "")
  );
  const appliesToAllProducts = selectedPromotion && promotionAppliesToAllProducts(selectedPromotion);
  const eligibleProductIds = new Set(selectedPromotion && Array.isArray(selectedPromotion.productIds)
    ? selectedPromotion.productIds.map(String)
    : []);
  const subtotal = cart.reduce((sum, product) => {
    const quantity = Math.max(1, Number(product.quantity) || 1);
    return sum + Number(product.price || 0) * quantity;
  }, 0);
  const savings = Math.min(subtotal, Math.round(cart.reduce((sum, product) => {
    if (!selectedPromotion
      || (!appliesToAllProducts && !eligibleProductIds.has(String(product.id)))) return sum;
    const quantity = Math.max(1, Number(product.quantity) || 1);
    return sum + Number(product.price || 0) * quantity * Number(selectedPromotion.discountPercent) / 100;
  }, 0)));
  return {
    subtotal,
    savings,
    tax: 0,
    total: subtotal - savings
  };
}

function renderCartSummary(cart) {
  const { subtotal, savings, total } = calculateCartTotals(cart);
  const originalPriceElement = document.getElementById("originalprice");
  const savingsElement = document.getElementById("savings");
  const deliveryElement = document.getElementById("deliveryCharge");
  const totalElement = document.getElementById("total");

  if (originalPriceElement) originalPriceElement.textContent = formatVnd(subtotal);
  if (savingsElement) savingsElement.textContent = formatVnd(savings);
  if (deliveryElement) deliveryElement.textContent = "Miễn phí";
  if (totalElement) totalElement.textContent = formatVnd(total);
}

window.addEventListener("storage", (event) => {
  if (event.key !== "flowerPromotions") return;
  try {
    const cart = window.FlowerSafeStorage.readJson("cart", {
      fallback: [],
      validate: (value) => Array.isArray(value)
        && value.every((item) => item && typeof item === "object" && !Array.isArray(item) && item.id !== undefined)
    });
    renderCartSummary(cart);
  } catch (error) {
    console.error("Không thể cập nhật tổng tiền sau khi ưu đãi thay đổi:", error);
  }
});
