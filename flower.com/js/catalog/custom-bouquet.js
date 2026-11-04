const flowerList = document.getElementById("custom-bouquet-list");
const feedback = document.getElementById("custom-bouquet-message");
const totalLabel = document.getElementById("custom-bouquet-total");
const addButton = document.getElementById("custom-bouquet-add");
let availableFlowers = [];

function vietnameseDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function selectedFlowers() {
  return [...flowerList.querySelectorAll("input[data-flower-id]")].map((input) => ({
    product: availableFlowers.find((flower) => String(flower.id) === input.dataset.flowerId),
    quantity: input.value === "" ? 0 : Number(input.value),
    valid: Number.isInteger(Number(input.value || 0))
      && Number(input.value || 0) >= 0
      && Number(input.value || 0) <= Number(input.max)
  }));
}

function updateEstimate() {
  const items = selectedFlowers();
  const selected = items.filter((item) => item.product && item.quantity > 0);
  const subtotal = selected.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const valid = items.every((item) => item.valid);
  totalLabel.textContent = valid ? `Tạm tính: ${formatVnd(subtotal)}` : "Vui lòng nhập số cành hợp lệ theo tồn kho.";
  addButton.disabled = selected.length === 0 || !valid;
}

function renderFlowers() {
  flowerList.replaceChildren();
  if (!availableFlowers.length) {
    const empty = document.createElement("p");
    empty.className = "custom-bouquet-empty";
    empty.textContent = "Cửa hàng chưa thêm hoa nguyên liệu có giá hôm nay. Vui lòng quay lại sau hoặc xem bó hoa làm sẵn.";
    flowerList.append(empty);
    return;
  }

  for (const flower of availableFlowers) {
    const card = document.createElement("article");
    const image = document.createElement("img");
    const details = document.createElement("div");
    const title = document.createElement("h2");
    const price = document.createElement("p");
    const stock = document.createElement("p");
    const input = document.createElement("input");

    card.className = "custom-flower-card";
    image.src = flower.image || "./favicon.svg";
    image.alt = flower.title;
    image.width = 84;
    image.height = 84;
    image.loading = "lazy";
    title.textContent = flower.title;
    price.textContent = `${formatVnd(flower.price)} / cành`;
    stock.textContent = `Còn ${flower.quantity} cành · giá cập nhật hôm nay`;
    input.type = "number";
    input.min = "0";
    input.max = String(Math.min(flower.quantity, 50));
    input.step = "1";
    input.value = "0";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", `Số cành ${flower.title}`);
    input.dataset.flowerId = String(flower.id);
    input.addEventListener("input", updateEstimate);
    details.append(title, price, stock, input);
    card.append(image, details);
    flowerList.append(card);
  }
}

addButton.addEventListener("click", () => {
  const items = selectedFlowers();
  const selected = items.filter((item) => item.product && item.quantity > 0);
  if (items.some((item) => !item.valid)) {
    updateEstimate();
    return;
  }
  try {
    const cart = FlowerShoppingStore.readCart();
    for (const item of selected) {
      const current = cart.filter((line) => String(line.productId ?? line.id) === String(item.product.id))
        .reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      if (current + item.quantity > Math.min(item.product.quantity, FlowerShoppingStore.MAX_QUANTITY_PER_PRODUCT)) {
        throw new Error(`Chỉ còn ${Math.max(0, Math.min(item.product.quantity, FlowerShoppingStore.MAX_QUANTITY_PER_PRODUCT) - current)} cành ${item.product.title} có thể thêm.`);
      }
    }
    for (const item of selected) {
      FlowerShoppingStore.addToCart(item.product, item.quantity);
    }
    feedback.className = "";
    feedback.textContent = "Đã thêm thành phần bó hoa vào giỏ. Bạn có thể tiếp tục thanh toán.";
  } catch (error) {
    console.error("Không thể thêm hoa vào giỏ:", error);
    feedback.className = "is-error";
    feedback.textContent = error.message || "Chưa thể thêm hoa vào giỏ. Vui lòng thử lại.";
  }
});

async function initializeCustomBouquet() {
  try {
    const products = await FlowerInventory.initialize();
    availableFlowers = products.filter((flower) => flower.status !== "hidden"
      && flower.saleType === "flower"
      && Number.isSafeInteger(flower.price)
      && flower.price > 0
      && flower.priceUpdatedAt === vietnameseDate()
      && Number.isInteger(flower.quantity)
      && flower.quantity > 0);
    renderFlowers();
  } catch (error) {
    console.error("Không thể tải hoa nguyên liệu:", error);
    feedback.className = "is-error";
    feedback.textContent = "Chưa thể tải giá hoa hôm nay. Vui lòng tải lại trang.";
  }
}

initializeCustomBouquet();
