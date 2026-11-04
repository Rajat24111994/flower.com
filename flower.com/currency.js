const USD_TO_VND = 25949.123093;
const VND_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

function formatVnd(amountInUsd) {
  return VND_FORMATTER.format(Number(amountInUsd) * USD_TO_VND);
}

function toVndAmount(amountInUsd) {
  return Math.round(Number(amountInUsd) * USD_TO_VND);
}

function usdFromVnd(amountInVnd) {
  return Number((Number(amountInVnd) / USD_TO_VND).toFixed(6));
}

function promotionAppliesToAllProducts(promotion) {
  return promotion.allProducts === true;
}

function getAvailableCartPromotions(cart) {
  const promotions = JSON.parse(localStorage.getItem("flowerPromotions") || "[]");
  if (!Array.isArray(promotions)) return [];

  return promotions.filter((promotion) => {
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

function calculateCartTotals(cart, promotionId = localStorage.getItem("flowerSelectedPromotion")) {
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
  const savings = cart.reduce((sum, product) => {
    if (!selectedPromotion
      || (!appliesToAllProducts && !eligibleProductIds.has(String(product.id)))) return sum;
    const quantity = Math.max(1, Number(product.quantity) || 1);
    return sum + Number(product.price || 0) * quantity * Number(selectedPromotion.discountPercent) / 100;
  }, 0);
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
    renderCartSummary(JSON.parse(localStorage.getItem("cart") || "[]"));
  } catch (error) {
    console.error("Không thể cập nhật tổng tiền sau khi ưu đãi thay đổi:", error);
  }
});