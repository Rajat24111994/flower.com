const featuredProductsContainer = document.getElementById("featured-products");

function formatHomepagePrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "Liên hệ";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function renderFeaturedProducts(products) {
  if (!featuredProductsContainer) return;

  const availableProducts = (Array.isArray(products) ? products : [])
    .filter((product) => product
      && product.status !== "hidden"
      && product.saleType !== "flower"
      && Number(product.quantity) > 0
      && product.id !== undefined
      && product.image)
    .sort((first, second) => Number(second.soldCount || 0) - Number(first.soldCount || 0))
    .slice(0, 4);

  featuredProductsContainer.replaceChildren();
  featuredProductsContainer.setAttribute("aria-busy", "false");

  if (!availableProducts.length) {
    const status = document.createElement("p");
    status.className = "featured-status";
    status.textContent = "Mời bạn khám phá các mẫu hoa trong cửa hàng.";
    featuredProductsContainer.append(status);
    return;
  }

  availableProducts.forEach((product) => {
    const card = document.createElement("article");
    card.className = "featured-card";

    const link = document.createElement("a");
    link.className = "featured-card-image";
    link.href = `./product.html?id=${encodeURIComponent(String(product.id))}`;
    link.setAttribute("aria-label", `Xem ${product.title || "sản phẩm hoa"}`);

    const image = document.createElement("img");
    image.src = product.image;
    image.alt = product.title ? `Ảnh ${product.title}` : "Bó hoa tươi Flowerflow";
    image.loading = "lazy";
    image.decoding = "async";
    link.append(image);

    const content = document.createElement("div");
    content.className = "featured-card-content";

    const title = document.createElement("h3");
    title.textContent = product.title || "Bó hoa tươi";

    const price = document.createElement("span");
    price.className = "featured-card-price";
    price.textContent = formatHomepagePrice(product.price);

    const action = document.createElement("a");
    action.className = "featured-card-action";
    action.href = link.href;
    action.textContent = "Xem và đặt mua";

    content.append(title, price, action);
    card.append(link, content);
    featuredProductsContainer.append(card);
  });
}

if (featuredProductsContainer) {
  window.addEventListener("flowerinventorychange", (event) => {
    renderFeaturedProducts(event.detail);
  });

  if (window.FlowerInventory) {
    renderFeaturedProducts(window.FlowerInventory.readProducts());
    window.FlowerInventory.initialize()
      .then(renderFeaturedProducts)
      .catch(() => renderFeaturedProducts([]));
  } else {
    featuredProductsContainer.setAttribute("aria-busy", "false");
  }
}
