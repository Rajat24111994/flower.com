(function initializeShoppingStore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerShoppingStore = api.createShoppingStore(() => root.localStorage);
})(typeof globalThis !== "undefined" ? globalThis : this, function createShoppingStoreModule() {
  class ShoppingStoreError extends Error {
    constructor(message, code, cause) {
      super(message);
      this.name = "ShoppingStoreError";
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  function createShoppingStore(getStorage) {
    function storage() {
      try {
        const value = getStorage();
        if (!value) throw new Error("Browser storage is unavailable");
        return value;
      } catch (error) {
        throw new ShoppingStoreError("Không thể truy cập dữ liệu mua sắm trên trình duyệt.", "storage-unavailable", error);
      }
    }

    function readList(key) {
      let value;
      try {
        value = storage().getItem(key);
      } catch (error) {
        if (error instanceof ShoppingStoreError) throw error;
        throw new ShoppingStoreError("Không thể đọc dữ liệu mua sắm. Vui lòng tải lại trang.", "storage-read-failed", error);
      }
      if (value === null) return [];

      let items;
      try {
        items = JSON.parse(value);
      } catch (error) {
        throw new ShoppingStoreError("Dữ liệu mua sắm bị lỗi định dạng. Vui lòng kiểm tra lại giỏ hàng.", "storage-invalid-data", error);
      }
      if (!Array.isArray(items)) {
        throw new ShoppingStoreError("Dữ liệu mua sắm không hợp lệ. Vui lòng kiểm tra lại giỏ hàng.", "storage-invalid-data");
      }
      if (items.some((item) => !item || typeof item !== "object" || Array.isArray(item)
        || item.id === undefined || item.id === null || String(item.id) === ""
        || (key === "cart" && item.quantity !== undefined
          && (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)))) {
        throw new ShoppingStoreError("Dữ liệu sản phẩm trong giỏ hoặc danh sách yêu thích không hợp lệ.", "storage-invalid-data");
      }
      return items;
    }

    function writeList(key, items) {
      try {
        storage().setItem(key, JSON.stringify(items));
      } catch (error) {
        if (error instanceof ShoppingStoreError) throw error;
        throw new ShoppingStoreError("Không thể lưu thay đổi. Hãy kiểm tra dung lượng trình duyệt rồi thử lại.", "storage-write-failed", error);
      }
    }

    function getProductId(product) {
      if (!product || product.id === undefined || product.id === null || String(product.id) === "") {
        throw new ShoppingStoreError("Không xác định được sản phẩm cần cập nhật.", "invalid-product");
      }
      return String(product.id);
    }

    function readCart() {
      return readList("cart");
    }

    function readWishlist() {
      return readList("wish");
    }

    function addToCart(product, requestedQuantity = 1) {
      const productId = getProductId(product);
      const quantity = Number(requestedQuantity);
      const stock = Number(product.quantity);
      const price = Number(product.price);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ShoppingStoreError("Số lượng phải là số nguyên lớn hơn 0.", "invalid-quantity");
      }
      if (!Number.isFinite(stock) || stock < 0) {
        throw new ShoppingStoreError("Không thể xác minh tồn kho sản phẩm. Vui lòng tải lại danh sách hoa.", "invalid-stock");
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new ShoppingStoreError("Giá sản phẩm không hợp lệ. Vui lòng tải lại danh sách hoa.", "invalid-price");
      }
      if (stock === 0) {
        throw new ShoppingStoreError("Sản phẩm hiện đã hết hàng.", "out-of-stock");
      }

      const cart = readCart();
      const existingQuantity = cart
        .filter((item) => String(item.id) === productId)
        .reduce((sum, item) => sum + Number(item.quantity ?? 1), 0);
      if (existingQuantity + quantity > stock) {
        const remaining = Math.max(0, stock - existingQuantity);
        throw new ShoppingStoreError(
          remaining
            ? `Chỉ còn ${remaining} sản phẩm có thể thêm vào giỏ.`
            : "Giỏ hàng đã có đủ số lượng tồn kho của sản phẩm này.",
          "exceeds-stock"
        );
      }

      const nextCart = cart.filter((item) => String(item.id) !== productId);
      nextCart.push({
        ...product,
        price,
        stockQuantity: stock,
        quantity: existingQuantity + quantity
      });
      writeList("cart", nextCart);
      return nextCart;
    }

    function toggleWishlist(product) {
      const productId = getProductId(product);
      const wishlist = readWishlist();
      const exists = wishlist.some((item) => String(item.id) === productId);
      const nextWishlist = exists
        ? wishlist.filter((item) => String(item.id) !== productId)
        : [...wishlist, product];
      writeList("wish", nextWishlist);
      return { wishlist: nextWishlist, added: !exists };
    }

    function removeFromWishlist(productId) {
      const nextWishlist = readWishlist().filter((item) => String(item.id) !== String(productId));
      writeList("wish", nextWishlist);
      return nextWishlist;
    }

    return { readCart, readWishlist, addToCart, toggleWishlist, removeFromWishlist };
  }

  return { createShoppingStore, ShoppingStoreError };
});
