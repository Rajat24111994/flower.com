const flowerList = document.getElementById("custom-bouquet-list");
const feedback = document.getElementById("custom-bouquet-message");
const totalLabel = document.getElementById("custom-bouquet-total");
const addButton = document.getElementById("custom-bouquet-add");
const orderNowButton = document.getElementById("design-order-now");
const requestButton = document.getElementById("design-request-submit");
const requestResult = document.getElementById("design-request-result");
const selectedList = document.getElementById("design-selected");
const designPreview = document.getElementById("design-preview");
const MAX_STEMS = FlowerBouquetWrapping.MAX_STEMS_PER_BOUQUET;
const FLOWER_COLORS = ["Trắng", "Đen", "Kem", "Hồng", "Đỏ", "Vàng", "Cam", "Xanh", "Tím", "Nhiều màu", "Khác"];
let availableFlowers = [];
let wrappingTiers = null;
let deliveryZones = [];
let referenceImage = "";
let quoteIsAvailable = false;
let requestInProgress = false;

function vietnameseDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeColor(value) {
  const key = String(value || "").trim().toLocaleLowerCase("vi");
  const aliases = {
    white: "Trắng", black: "Đen", cream: "Kem", pink: "Hồng", red: "Đỏ", yellow: "Vàng",
    orange: "Cam", green: "Xanh", blue: "Xanh", purple: "Tím", multicolor: "Nhiều màu"
  };
  return FLOWER_COLORS.find((color) => color.toLocaleLowerCase("vi") === key) || aliases[key] || "";
}

function colorsForFlower(flower) {
  const configured = Array.isArray(flower.colors) ? flower.colors.map(normalizeColor).filter(Boolean) : [];
  return [...new Set(configured.length ? configured : FLOWER_COLORS)];
}

function selectedFlowers() {
  return [...flowerList.querySelectorAll("input[data-flower-id]")].map((input) => {
    const product = availableFlowers.find((flower) => String(flower.id) === input.dataset.flowerId);
    const quantity = input.value === "" ? 0 : Number(input.value);
    const color = input.closest("[data-flower-card]")?.querySelector("[data-flower-color]")?.value || "Hồng";
    const role = input.closest("[data-flower-card]")?.querySelector("[data-flower-role]")?.value || "support";
    return {
      product,
      quantity,
      color,
      role,
      valid: Number.isInteger(quantity) && quantity >= 0
        && quantity <= Math.min(Number(product?.quantity) || 0, MAX_STEMS)
    };
  });
}

function readDesignOptions() {
  const design = {};
  document.querySelectorAll("[data-design]").forEach((input) => {
    const key = input.dataset.design;
    if (input.type === "checkbox") design[key] = input.checked;
    else if (key === "excludedFlowers" || key === "dislikedFlowers") {
      design[key] = input.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
    } else {
      design[key] = input.value;
    }
  });
  design.addons = [...document.querySelectorAll("[data-addon]:checked")].map((input) => input.value);
  return design;
}

function currentDesign() {
  return { stems: selectedFlowers().filter((item) => item.product && item.quantity > 0), design: readDesignOptions() };
}

function updatePreview(selected, stemCount) {
  designPreview.replaceChildren();
  selectedList.replaceChildren();
  if (!selected.length) {
    const empty = document.createElement("p");
    empty.className = "design-preview-empty";
    empty.textContent = "Chọn hoa để xem minh họa bố cục.";
    designPreview.append(empty);
    if (readDesignOptions().surprise) selectedList.textContent = "Cửa hàng sẽ gợi ý loại hoa trong ngân sách bạn nhập.";
    return;
  }
  selected.forEach((item) => {
    const previewItem = document.createElement("div");
    const image = document.createElement("img");
    const label = document.createElement("span");
    image.src = item.product.image || "./favicon.svg";
    image.alt = "";
    image.loading = "lazy";
    label.textContent = `${item.product.title} × ${item.quantity}`;
    previewItem.className = "design-preview-item";
    previewItem.append(image, label);
    designPreview.append(previewItem);

    const line = document.createElement("div");
    line.textContent = `${item.role === "main" ? "Hoa chính" : "Hoa phụ"}: ${item.product.title} × ${item.quantity} · ${item.color} · ${formatVnd(item.product.price * item.quantity)}`;
    selectedList.append(line);
  });
  designPreview.setAttribute("aria-label", `Minh họa tham khảo gồm ${stemCount} cành`);
}

function updateEstimate() {
  const items = selectedFlowers();
  const selected = items.filter((item) => item.product && item.quantity > 0);
  const stemCount = selected.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = selected.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const valid = items.every((item) => item.valid);
  const design = readDesignOptions();
  const wrappingFee = valid && stemCount > 0
    ? FlowerBouquetWrapping.feeForDesign(wrappingTiers, stemCount, design)
    : stemCount === 0 && design.surprise ? 0 : null;
  const total = subtotal + (wrappingFee || 0);
  const budget = Number(design.budget || 0);
  const directOrderAllowed = design.addons.length === 0 && !design.greenery && !design.surprise
  && design.wrapStyle !== "Không gói" && Number(design.paperLayers) > 0;
  if (!quoteIsAvailable) totalLabel.textContent = "Chưa thể xác minh bậc phí bó hoa.";
  else if (stemCount > MAX_STEMS) totalLabel.textContent = `Mỗi bó tối đa ${MAX_STEMS} cành.`;
  else if (!valid) totalLabel.textContent = "Vui lòng nhập số cành hợp lệ theo tồn kho.";
  else if (wrappingFee === null) totalLabel.textContent = "Chưa thể xác định phí gói cho số cành đã chọn.";
  else totalLabel.textContent = `Tiền hoa: ${formatVnd(subtotal)} · Phí gói: ${formatVnd(wrappingFee)} · Tổng dự toán: ${formatVnd(total)}`;
  document.getElementById("design-budget-message").textContent = budget > 0 && total > budget
    ? `Dự toán hiện tại vượt ngân sách ${formatVnd(budget)}. Có thể chỉnh số lượng hoặc yêu cầu cửa hàng tư vấn.`
    : "";
  document.getElementById("design-direct-order-note").textContent = directOrderAllowed
    ? ""
    : design.addons.length || design.greenery
      ? "Thiết kế có phụ kiện hoặc lá trang trí cần cửa hàng xác nhận giá; hãy gửi yêu cầu tư vấn thay vì thanh toán trực tiếp."
      : design.wrapStyle === "Không gói" || Number(design.paperLayers) === 0
        ? "Bó không dùng giấy gói cần cửa hàng xác nhận thiết kế; hãy gửi yêu cầu tư vấn để chốt đơn."
        : "Thiết kế bất ngờ theo ngân sách cần cửa hàng tư vấn và báo giá trước.";
  updatePreview(selected, stemCount);
  const canAdd = selected.length > 0 && valid && stemCount <= MAX_STEMS && wrappingFee !== null && quoteIsAvailable && directOrderAllowed;
  addButton.disabled = !canAdd;
  orderNowButton.disabled = !canAdd;
  const canRequestConsult = (selected.length > 0 || (design.surprise && budget > 0))
    && valid && stemCount <= MAX_STEMS && quoteIsAvailable && deliveryZones.length > 0 && !requestInProgress;
  requestButton.disabled = !canRequestConsult;
}

function renderFlowers() {
  const search = document.getElementById("flower-search").value.trim().toLocaleLowerCase("vi");
  const colorFilter = document.getElementById("flower-color-filter").value;
  const maxPriceValue = document.getElementById("flower-price-filter").value;
  const maxPrice = maxPriceValue === "" ? Infinity : Number(maxPriceValue);
  const filtered = availableFlowers.filter((flower) => {
    const matchesText = !search || `${flower.title} ${flower.category || ""}`.toLocaleLowerCase("vi").includes(search);
    const matchesColor = !colorFilter || colorsForFlower(flower).includes(colorFilter);
    return matchesText && matchesColor && flower.price <= maxPrice;
  });
  flowerList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "custom-bouquet-empty";
    empty.textContent = availableFlowers.length
      ? "Không tìm thấy loại hoa phù hợp bộ lọc."
      : "Cửa hàng chưa thêm hoa nguyên liệu có giá hôm nay. Vui lòng quay lại sau hoặc xem bó hoa làm sẵn.";
    flowerList.append(empty);
    return;
  }

  const current = new Map(selectedFlowers().map((item) => [String(item.product?.id), item]));
  for (const flower of filtered) {
    const card = document.createElement("article");
    const image = document.createElement("img");
    const details = document.createElement("div");
    const title = document.createElement("h2");
    const price = document.createElement("p");
    const stock = document.createElement("p");
    const controls = document.createElement("div");
    const quantityLabel = document.createElement("label");
    const input = document.createElement("input");
    const colorLabel = document.createElement("label");
    const color = document.createElement("select");
    const roleLabel = document.createElement("label");
    const role = document.createElement("select");
    const remove = document.createElement("button");
    const selection = current.get(String(flower.id));
    const flowerColors = colorsForFlower(flower);

    card.className = "custom-flower-card";
    card.dataset.flowerCard = "";
    image.src = flower.image || "./favicon.svg";
    image.alt = flower.title;
    image.width = 84;
    image.height = 84;
    image.loading = "lazy";
    title.textContent = flower.title;
    price.textContent = `${formatVnd(flower.price)} / cành`;
    stock.textContent = flower.quantity > 0
      ? `Còn ${flower.quantity} cành · màu sẽ được xác nhận`
      : "Hết hàng · tồn kho hiển thị theo loại hoa";
    input.type = "number";
    input.min = "0";
    input.max = String(Math.min(flower.quantity, MAX_STEMS));
    input.disabled = flower.quantity <= 0;
    input.step = "1";
    input.value = String(selection?.quantity || 0);
    input.inputMode = "numeric";
    input.setAttribute("aria-label", `Số cành ${flower.title}`);
    input.dataset.flowerId = String(flower.id);
    input.addEventListener("input", updateEstimate);
    colorLabel.textContent = "Màu";
    colorLabel.append(color);
    color.dataset.flowerColor = "";
    flowerColors.forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      option.selected = item === (selection?.color || flowerColors[0]);
      color.append(option);
    });
    color.addEventListener("change", updateEstimate);
    roleLabel.textContent = "Vai trò";
    role.dataset.flowerRole = "";
    [["main", "Hoa chính"], ["support", "Hoa phụ"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === (selection?.role || "support");
      role.append(option);
    });
    role.addEventListener("change", updateEstimate);
    remove.type = "button";
    remove.className = "flower-remove";
    remove.textContent = "Bỏ loại hoa này";
    remove.hidden = !selection?.quantity;
    remove.addEventListener("click", () => {
      input.value = "0";
      updateEstimate();
      renderFlowers();
    });
    quantityLabel.textContent = "Số cành";
    quantityLabel.append(input);
    controls.className = "flower-card-controls";
    controls.append(quantityLabel, colorLabel, roleLabel, remove);
    details.append(title, price, stock, controls);
    card.append(image, details);
    flowerList.append(card);
  }
}

function createBouquetId() {
  return `bouquet_${window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`}`;
}

function addDesignToCart() {
  const { stems, design } = currentDesign();
  const selected = stems;
  const stemCount = selected.reduce((sum, item) => sum + item.quantity, 0);
  if (!selected.length || stemCount > MAX_STEMS || selectedFlowers().some((item) => !item.valid) || !wrappingTiers) {
    updateEstimate();
    return false;
  }
  try {
    const sharedDetails = [
      `Bố cục: ${design.arrangement}; kích thước: ${design.size}`,
      `Kiểu gói: ${design.wrapStyle}; giấy ${design.paperMaterial} màu ${design.paperColor}, ${design.paperLayers} lớp`,
      `Nơ: ${design.bowStyle}, màu ${design.bowColor}`,
      `Chủ đề: ${design.theme}; phong cách: ${design.style}; tông ${design.palette}`,
      design.anonymousGreetingCard ? "Ẩn thông tin người gửi trên thiệp" : "",
      design.lowFragrance ? "Ưu tiên hoa ít mùi" : "",
      design.dislikedFlowers.length ? `Người nhận không thích: ${design.dislikedFlowers.join(", ")}` : "",
      design.excludedFlowers.length ? `Không dùng: ${design.excludedFlowers.join(", ")}` : "",
      design.specialRequest
    ].filter(Boolean).join(" · ");
    if (sharedDetails.length > 500) throw new Error("Ghi chú thiết kế quá dài để đặt trực tiếp; hãy gửi yêu cầu tư vấn để giữ đầy đủ thông tin.");
    const cart = FlowerShoppingStore.readCart();
    for (const item of selected) {
      const current = cart.filter((line) => String(line.productId ?? line.id) === String(item.product.id))
        .reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      if (current + item.quantity > Math.min(item.product.quantity, FlowerShoppingStore.MAX_QUANTITY_PER_PRODUCT)) {
        throw new Error(`Chỉ còn ${Math.max(0, Math.min(item.product.quantity, FlowerShoppingStore.MAX_QUANTITY_PER_PRODUCT) - current)} cành ${item.product.title} có thể thêm.`);
      }
    }
    const customBouquetId = createBouquetId();
    for (const item of selected) {
      const flower = {
        ...item.product,
        productId: String(item.product.id),
        cardMessage: design.greetingCard || "",
        personalNote: `Màu mong muốn: ${item.color}; vai trò: ${item.role === "main" ? "hoa chính" : "hoa phụ"} · ${sharedDetails}`
      };
      FlowerShoppingStore.addToCart(flower, item.quantity, { customBouquetId });
    }
    feedback.className = "";
    feedback.textContent = `Đã thêm bó hoa gồm ${stemCount} cành vào giỏ.`;
    return true;
  } catch (error) {
    console.error("Không thể thêm hoa vào giỏ:", error);
    feedback.className = "is-error";
    feedback.textContent = error.message || "Chưa thể thêm hoa vào giỏ. Vui lòng thử lại.";
    return false;
  }
}

function setDefaultDeliveryDate() {
  const today = vietnameseDate();
  const date = document.getElementById("design-delivery-date");
  date.min = today;
  const todayAtNoon = new Date();
  date.value = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(todayAtNoon.getTime() + 24 * 60 * 60 * 1000));
}

async function loadReferenceImage(file) {
  const status = document.getElementById("design-image-message");
  if (!file) {
    referenceImage = "";
    document.getElementById("design-reference-preview").hidden = true;
    updateEstimate();
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    status.textContent = "Chỉ nhận ảnh JPG, PNG hoặc WebP tối đa 5 MB.";
    document.getElementById("design-reference-image").value = "";
    referenceImage = "";
    updateEstimate();
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let dataUri = canvas.toDataURL("image/webp", 0.8);
    if (dataUri.length > 340000) dataUri = canvas.toDataURL("image/jpeg", 0.65);
    if (dataUri.length > 340000) throw new Error("Ảnh sau khi nén vẫn vượt giới hạn 250 KB.");
    referenceImage = dataUri;
    const preview = document.getElementById("design-reference-preview");
    preview.src = dataUri;
    preview.hidden = false;
    status.textContent = "Ảnh mẫu đã được nén; cửa hàng sẽ dùng làm tham khảo.";
  } catch (error) {
    console.error("Không thể xử lý ảnh mẫu:", error);
    status.textContent = error.message || "Không thể đọc ảnh này. Hãy chọn ảnh khác.";
    referenceImage = "";
  }
  updateEstimate();
}

function saveDesign() {
  try {
    const { stems, design } = currentDesign();
    const draft = {
      stems: stems.map(({ product, quantity, color, role }) => ({
        productId: String(product.id), quantity, color, role
      })),
      design,
      referenceImage,
      savedAt: new Date().toISOString()
    };
    FlowerSafeStorage.writeJson("flowerDesignDraft", draft, { required: true });
    feedback.className = "";
    feedback.textContent = "Đã lưu thiết kế trên trình duyệt này.";
  } catch (error) {
    console.error("Không thể lưu thiết kế:", error);
    feedback.className = "is-error";
    feedback.textContent = error.message || "Chưa thể lưu thiết kế.";
  }
}

function loadSavedDesign() {
  const draft = FlowerSafeStorage.readJson("flowerDesignDraft", { fallback: null });
  if (!draft || typeof draft !== "object") return;
  const byId = new Map((draft.stems || []).map((item) => [String(item.productId), item]));
  flowerList.querySelectorAll("input[data-flower-id]").forEach((input) => {
    const saved = byId.get(input.dataset.flowerId);
    if (!saved) return;
    input.value = String(saved.quantity);
    const card = input.closest("[data-flower-card]");
    if (card.querySelector("[data-flower-color]")) card.querySelector("[data-flower-color]").value = saved.color;
    if (card.querySelector("[data-flower-role]")) card.querySelector("[data-flower-role]").value = saved.role;
  });
  for (const [key, value] of Object.entries(draft.design || {})) {
    const input = document.querySelector(`[data-design="${key}"]`);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = value === true;
    else if (Array.isArray(value)) input.value = value.join(", ");
    else input.value = value;
  }
  document.querySelectorAll("[data-addon]").forEach((input) => {
    input.checked = (draft.design?.addons || []).includes(input.value);
  });
  if (typeof draft.referenceImage === "string" && draft.referenceImage.startsWith("data:image/")) {
    referenceImage = draft.referenceImage;
    const preview = document.getElementById("design-reference-preview");
    preview.src = referenceImage;
    preview.hidden = false;
  }
}

function resetDesign() {
  flowerList.querySelectorAll("input[data-flower-id]").forEach((input) => { input.value = "0"; });
  document.querySelectorAll("[data-addon]").forEach((input) => { input.checked = false; });
  document.querySelectorAll("[data-design]").forEach((input) => {
    if (input.type === "checkbox") input.checked = input.dataset.design === "confirmBeforeMaking";
    else if (input.type === "number" || input.type === "text") input.value = "";
    else input.selectedIndex = 0;
  });
  document.getElementById("design-reference-image").value = "";
  document.getElementById("design-reference-preview").hidden = true;
  document.getElementById("design-image-message").textContent = "";
  referenceImage = "";
  updateEstimate();
}

function validRequestFields() {
  const requiredIds = ["design-customer-name", "design-phone", "design-address", "design-delivery-date", "design-delivery-time", "design-delivery-zone"];
  for (const id of requiredIds) {
    const input = document.getElementById(id);
    if (!input.value || !input.reportValidity()) return false;
  }
  return true;
}

async function sendDesignRequest() {
  const { stems, design } = currentDesign();
  const stemCount = stems.reduce((sum, item) => sum + item.quantity, 0);
  if (!validRequestFields() || selectedFlowers().some((item) => !item.valid) || stemCount > MAX_STEMS) {
    updateEstimate();
    return;
  }
  requestInProgress = true;
  updateEstimate();
  requestButton.textContent = "Đang gửi yêu cầu…";
  requestResult.textContent = "";
  try {
    const mainFlower = stems.find((item) => item.role === "main");
    const result = await FlowerOrderStore.createDesignRequest({
      customerName: document.getElementById("design-customer-name").value.trim(),
      phone: document.getElementById("design-phone").value.trim(),
      address: document.getElementById("design-address").value.trim(),
      deliveryDate: document.getElementById("design-delivery-date").value,
      deliveryTime: document.getElementById("design-delivery-time").value,
      deliveryZoneId: document.getElementById("design-delivery-zone").value,
      deliveryNote: document.getElementById("design-delivery-note").value.trim(),
      stems: stems.map(({ product, quantity, color, role }) => ({
        productId: String(product.id), quantity, color, role
      })),
      design: { ...design, mainProductId: mainFlower ? String(mainFlower.product.id) : "" },
      referenceImage
    });
    let tokenSaved = false;
    try {
      const savedRequests = FlowerSafeStorage.readJson("flowerDesignRequestAccess", { fallback: {} });
      savedRequests[result.request.id] = result.accessToken;
      FlowerSafeStorage.writeJson("flowerDesignRequestAccess", savedRequests, { required: true });
      tokenSaved = true;
    } catch (storageError) {
      console.error("Yêu cầu đã lưu nhưng không thể lưu mã truy cập trên thiết bị:", storageError);
    }
    requestResult.textContent = `Đã lưu yêu cầu #${result.request.id}. Dự toán ban đầu ${formatVnd(result.request.estimatedTotal)} chưa gồm phụ kiện hoặc chi phí phát sinh. Mã truy cập: ${result.accessToken}${tokenSaved ? " (đã lưu trên thiết bị này)" : " (hãy lưu lại để theo dõi nếu đóng trang)"}. `;
    const link = document.createElement("a");
    link.href = `./design-request.html?id=${encodeURIComponent(result.request.id)}`;
    link.textContent = " · Theo dõi yêu cầu";
    requestResult.append(link);
  } catch (error) {
    console.error("Không thể gửi yêu cầu thiết kế:", error);
    requestResult.textContent = error.message || "Chưa thể gửi yêu cầu. Vui lòng thử lại.";
    feedback.className = "is-error";
  } finally {
    requestInProgress = false;
    requestButton.textContent = "Gửi yêu cầu tư vấn";
    updateEstimate();
  }
}

function loadDeliveryZones() {
  return FlowerOrderStore.getDeliveryZones().then((result) => {
    deliveryZones = Array.isArray(result.zones) ? result.zones.filter((zone) => zone.enabled !== false) : [];
    const select = document.getElementById("design-delivery-zone");
    select.replaceChildren(new Option(deliveryZones.length ? "Chọn khu vực" : "Chưa có khu vực giao hàng", ""));
    deliveryZones.forEach((zone) => {
      select.add(new Option(`${zone.district}, ${zone.province} · ${formatVnd(zone.fee)}`, zone.id));
    });
    if (!deliveryZones.length) {
      feedback.className = "is-error";
      feedback.textContent = "Cửa hàng chưa cấu hình khu vực giao hàng nên chưa thể gửi yêu cầu giao tận nơi.";
    }
  }).catch((error) => {
    console.error("Không thể tải khu vực giao hàng cho yêu cầu thiết kế:", error);
    deliveryZones = [];
    const select = document.getElementById("design-delivery-zone");
    select.replaceChildren(new Option("Không thể tải khu vực giao hàng", ""));
    feedback.className = "is-error";
    feedback.textContent = error.message || "Chưa thể tải khu vực giao hàng. Vui lòng tải lại trang.";
  }).finally(updateEstimate);
}

async function initializeCustomBouquet() {
  const results = await Promise.allSettled([
    FlowerInventory.initialize(),
    FlowerOrderStore.getBouquetWrapping(),
    loadDeliveryZones()
  ]);
  if (results[0].status === "fulfilled") {
    const products = results[0].value;
    availableFlowers = products.filter((flower) => flower.status !== "hidden"
      && flower.saleType === "flower"
      && Number.isSafeInteger(flower.price)
      && flower.price > 0
      && Number.isInteger(flower.quantity)
      && flower.quantity >= 0);
  } else {
    console.error("Không thể tải hoa nguyên liệu:", results[0].reason);
    feedback.className = "is-error";
    feedback.textContent = "Chưa thể tải danh sách hoa nguyên liệu. Vui lòng tải lại trang.";
  }
  if (results[1].status === "fulfilled") {
    const config = results[1].value;
    wrappingTiers = config.configured ? FlowerBouquetWrapping.normalizeTiers(config.tiers) : null;
  } else {
    console.error("Không thể tải cấu hình phí bó hoa:", results[1].reason);
    feedback.className = "is-error";
    feedback.textContent = results[1].reason?.message || "Chưa thể tải cấu hình phí bó hoa.";
  }
  quoteIsAvailable = Boolean(wrappingTiers);
  if (!wrappingTiers) {
    feedback.className = "is-error";
    feedback.textContent = "Cửa hàng chưa cấu hình bậc phí hợp lệ nên chưa thể báo giá hoặc đặt bó tùy chỉnh.";
  }
  setDefaultDeliveryDate();
  renderFlowers();
  loadSavedDesign();
  updateEstimate();
}

flowerList.addEventListener("input", updateEstimate);
document.getElementById("flower-search").addEventListener("input", renderFlowers);
document.getElementById("flower-color-filter").addEventListener("change", renderFlowers);
document.getElementById("flower-price-filter").addEventListener("input", renderFlowers);
document.querySelectorAll("[data-design], [data-addon]").forEach((input) => {
  input.addEventListener("input", updateEstimate);
  input.addEventListener("change", updateEstimate);
});
document.getElementById("design-reference-image").addEventListener("change", (event) => {
  void loadReferenceImage(event.currentTarget.files?.[0]);
});
document.getElementById("design-save").addEventListener("click", saveDesign);
document.getElementById("design-reset").addEventListener("click", resetDesign);
addButton.addEventListener("click", addDesignToCart);
orderNowButton.addEventListener("click", () => {
  if (addDesignToCart()) window.location.assign("./checkout.html");
});
requestButton.addEventListener("click", () => { void sendDesignRequest(); });
initializeCustomBouquet();
