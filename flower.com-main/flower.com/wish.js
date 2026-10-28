const container = document.getElementById("container");
const wishTotal = document.getElementById("wishTotal");
const cartTotal = document.getElementById("cartTotal");
let wishlist = [];
let products = [];

function showWishlistFeedback(title, icon, detail = "") {
  const message = document.getElementById("wishlist-message");
  message.textContent = detail;
  message.hidden = !detail;
  message.classList.toggle("is-error", icon === "error");
  if (typeof Swal !== "undefined") {
    Swal.fire({
      position: "center",
      icon,
      title,
      text: detail,
      showConfirmButton: false,
      timer: 1800
    });
  }
}

function showWishlistError(error) {
  console.error("Không thể cập nhật danh sách yêu thích hoặc giỏ hàng:", error);
  showWishlistFeedback("Chưa thể hoàn tất thao tác", "error", error.message || "Vui lòng thử lại.");
}

function resolveProduct(wishedProduct) {
  return products.find((product) => String(product.id) === String(wishedProduct.id)) || wishedProduct;
}

function renderWishlist() {
  wishTotal.textContent = wishlist.length;
  document.querySelectorAll(".favorite-count").forEach((count) => {
    count.textContent = String(wishlist.length);
  });
  container.replaceChildren();

  if (!wishlist.length) {
    const emptyMessage = document.createElement("p");
    const browseLink = document.createElement("a");
    emptyMessage.className = "empty-wishlist";
    emptyMessage.append("Danh sách yêu thích đang trống. ");
    browseLink.href = "./product.html";
    browseLink.textContent = "Khám phá các loài hoa";
    emptyMessage.append(browseLink);
    container.append(emptyMessage);
    return;
  }

  wishlist.forEach((savedProduct) => {
    const product = resolveProduct(savedProduct);
    const card = document.createElement("article");
    const image = document.createElement("img");
    const name = document.createElement("h2");
    const price = document.createElement("p");
    const stock = document.createElement("p");
    const actions = document.createElement("div");
    const addToCartButton = document.createElement("button");
    const removeButton = document.createElement("button");
    const quantity = Math.max(0, Number(product.quantity) || 0);

    card.className = "wishlist-card";
    image.src = product.image || "";
    image.alt = getVietnameseProductName(product.title || "Sản phẩm hoa");
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove(), { once: true });
    name.textContent = getVietnameseProductName(product.title || "Sản phẩm hoa");
    price.textContent = formatVnd(product.price);
    stock.className = quantity ? "wishlist-stock" : "wishlist-stock out-of-stock";
    stock.textContent = quantity ? `Còn hàng · ${quantity} sản phẩm` : "Hiện đã hết hàng";
    actions.className = "wishlist-card-actions";
    addToCartButton.type = "button";
    addToCartButton.className = "wishlist-add-to-cart";
    addToCartButton.textContent = "Thêm vào giỏ";
    addToCartButton.disabled = quantity === 0;
    addToCartButton.addEventListener("click", () => {
      try {
        const updatedCart = FlowerShoppingStore.addToCart(resolveProduct(savedProduct), 1);
        cartTotal.textContent = updatedCart.length;
        showWishlistFeedback("Đã thêm vào giỏ hàng", "success");
      } catch (error) {
        showWishlistError(error);
      }
    });
    removeButton.type = "button";
    removeButton.className = "wishlist-remove";
    removeButton.textContent = "Bỏ yêu thích";
    removeButton.addEventListener("click", () => {
      try {
        wishlist = FlowerShoppingStore.removeFromWishlist(savedProduct.id);
        renderWishlist();
        showWishlistFeedback("Đã xóa khỏi yêu thích", "success");
      } catch (error) {
        showWishlistError(error);
      }
    });

    actions.append(addToCartButton, removeButton);
    card.append(image, name, price, stock, actions);
    container.append(card);
  });
}

function loadWishlist() {
  try {
    wishlist = FlowerShoppingStore.readWishlist();
    cartTotal.textContent = FlowerShoppingStore.readCart().length;
    renderWishlist();
  } catch (error) {
    container.textContent = error.message || "Không thể tải danh sách yêu thích.";
    console.error("Không thể tải danh sách yêu thích:", error);
  }
}

loadWishlist();

window.addEventListener("storage", (event) => {
  if (event.key === "wish" || event.key === "cart") loadWishlist();
  if (event.key === "flowerInventory") {
    products = FlowerInventory.readProducts();
    renderWishlist();
  }
});

// The live Firestore sync arrives after initialize(): show the latest stock without a reload.
window.addEventListener("flowerinventorychange", (event) => {
  products = Array.isArray(event.detail) ? event.detail : FlowerInventory.readProducts();
  renderWishlist();
});

FlowerInventory.initialize()
  .then((inventory) => {
    products = inventory;
    renderWishlist();
  })
  .catch((error) => {
    console.error("Không thể đồng bộ sản phẩm trong danh sách yêu thích:", error);
    showWishlistFeedback("Chưa thể đồng bộ thông tin sản phẩm", "error", "Kiểm tra kết nối rồi tải lại trang.");
  });
