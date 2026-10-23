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

function renderCartSummary(cart) {
  const subtotal = cart.reduce((sum, product) => {
    const quantity = Math.max(1, Number(product.quantity) || 1);
    return sum + Number(product.price || 0) * quantity;
  }, 0);
  const savings = subtotal * 0.05;
  const tax = subtotal * 0.1;
  const originalPriceElement = document.getElementById("originalprice");
  const savingsElement = document.getElementById("savings");
  const deliveryElement = document.getElementById("deliveryCharge");
  const taxElement = document.getElementById("tax");
  const totalElement = document.getElementById("total");

  if (originalPriceElement) originalPriceElement.textContent = formatVnd(subtotal);
  if (savingsElement) savingsElement.textContent = formatVnd(savings);
  if (deliveryElement) deliveryElement.textContent = "Miễn phí";
  if (taxElement) taxElement.textContent = formatVnd(tax);
  if (totalElement) totalElement.textContent = formatVnd(subtotal - savings + tax);
}