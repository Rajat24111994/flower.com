(function initializeSafeStorage(root) {
  const reportedKeys = new Set();
  const labels = {
    cart: "giỏ hàng",
    wish: "danh sách yêu thích",
    flowerCheckout: "thông tin thanh toán",
    flowerCategories: "danh mục",
    flowerPromotions: "ưu đãi",
    loggedUser: "phiên tài khoản",
    flowerMessages: "phản hồi cũ",
    flowerReviews: "đánh giá cũ",
    usersData: "danh sách tài khoản",
    flowerInventory: "kho sản phẩm",
    flowerSelectedPromotion: "ưu đãi đã chọn",
    flowerMessagesMigratedV1: "trạng thái chuyển phản hồi",
    flowerReviewsAdminMigratedV1: "trạng thái chuyển đánh giá",
    loggedAdmin: "phiên quản trị"
  };

  function showStorageNotice(key, action = "read") {
    const noticeKey = `${action}:${key}`;
    if (reportedKeys.has(noticeKey) || !root.document?.body) return;
    reportedKeys.add(noticeKey);

    const notice = root.document.createElement("div");
    notice.setAttribute("role", "alert");
    notice.style.cssText = [
      "position:fixed", "z-index:2147483647", "top:12px", "left:50%",
      "transform:translateX(-50%)", "width:min(92vw,720px)", "box-sizing:border-box",
      "padding:14px 18px", "border:1px solid #d97706", "border-radius:10px",
      "background:#fff7ed", "color:#7c2d12", "font:14px/1.5 Arial,sans-serif",
      "box-shadow:0 4px 18px #0002"
    ].join(";");

    const message = root.document.createElement("span");
    const actionText = action === "write" ? "lưu" : action === "remove" ? "xóa" : "đọc";
    message.textContent = `Không thể ${actionText} ${labels[key] || "dữ liệu đã lưu"}. Thao tác có thể chưa được hoàn tất; dữ liệu cũ không bị ứng dụng tự ý ghi đè. Hãy tải lại trang; nếu lỗi còn, liên hệ quản trị viên.`;

    const close = root.document.createElement("button");
    close.type = "button";
    close.textContent = "Đóng";
    close.setAttribute("aria-label", "Đóng thông báo lỗi lưu trữ");
    close.style.cssText = "margin-left:12px;padding:5px 10px;border:0;border-radius:6px;background:#7c2d12;color:#fff;cursor:pointer";
    close.addEventListener("click", () => notice.remove());

    notice.append(message, close);
    root.document.body.append(notice);
  }

  function readJson(key, options = {}) {
    const {
      fallback = null,
      validate = () => true,
      onError,
      throwOnError = false
    } = options;

    function fail(code, cause) {
      const error = new Error(`Không đọc được dữ liệu đã lưu (${code}).`);
      error.name = "SafeStorageError";
      error.code = code;
      error.key = key;
      if (cause) error.cause = cause;
      if (typeof onError === "function") onError(error);
      showStorageNotice(key, "read");
      if (throwOnError) throw error;
      return fallback;
    }

    let raw;
    try {
      raw = root.localStorage.getItem(key);
    } catch (error) {
      return fail("storage-unavailable", error);
    }
    if (raw === null) return fallback;

    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return fail("invalid-json", error);
    }

    let isValid = false;
    try {
      isValid = validate(value) === true;
    } catch (error) {
      return fail("invalid-shape", error);
    }
    if (!isValid) return fail("invalid-shape");
    return value;
  }

  function writeJson(key, value, options = {}) {
    const { required = false } = options;
    let serialized;
    try {
      serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError("Giá trị không thể chuyển thành JSON.");
    } catch (cause) {
      return failWrite(key, cause, required);
    }
    try {
      root.localStorage.setItem(key, serialized);
      return true;
    } catch (cause) {
      return failWrite(key, cause, required);
    }
  }

  function readText(key, fallback = null) {
    try {
      const value = root.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (cause) {
      failWrite(key, cause, false, "read");
      return fallback;
    }
  }

  function writeText(key, value, options = {}) {
    const { required = false } = options;
    try {
      root.localStorage.setItem(key, String(value));
      return true;
    } catch (cause) {
      return failWrite(key, cause, required);
    }
  }

  function remove(key, options = {}) {
    const { required = false } = options;
    try {
      root.localStorage.removeItem(key);
      return true;
    } catch (cause) {
      return failWrite(key, cause, required, "remove");
    }
  }

  function failWrite(key, cause, required, action = "write") {
    const verb = action === "remove" ? "xóa" : action === "read" ? "đọc" : "lưu";
    const error = new Error("Không thể " + verb + " dữ liệu đã lưu.");
    error.name = "SafeStorageError";
    error.code = action === "remove" ? "storage-remove-failed" : action === "read" ? "storage-read-failed" : "storage-write-failed";
    error.key = key;
    error.cause = cause;
    showStorageNotice(key, action);
    if (required) throw error;
    return false;
  }

  root.FlowerSafeStorage = { readJson, readText, writeJson, writeText, remove };

  // Each account keeps its own cart and wishlist on a shared browser (F48). The active lists stay
  // in "cart"/"wish"; when the signed-in account changes, the old account's lists are put away
  // under flowerCart_<uid>/flowerWish_<uid> and the new account's come back, merged with whatever
  // was picked before signing in. Nothing is deleted: a customer who leaves can buy later.
  const OWNER_KEY = "flowerShoppingOwner";
  const isList = (value) => Array.isArray(value);

  function readList(key) {
    const value = readJson(key, { fallback: [], validate: isList });
    return isList(value) ? value : [];
  }

  function mergeCarts(saved, current) {
    const merged = saved.map((item) => ({ ...item }));
    current.forEach((item) => {
      const existing = merged.find((entry) => String(entry.id) === String(item.id));
      if (existing) existing.quantity = Math.max(1, Number(existing.quantity) || 1) + Math.max(1, Number(item.quantity) || 1);
      else merged.push({ ...item });
    });
    return merged;
  }

  function mergeWishlists(saved, current) {
    const ids = new Set(saved.map((item) => String(item.id)));
    return [...saved, ...current.filter((item) => !ids.has(String(item.id)))];
  }

  function putAway(uid) {
    const cart = readList("cart");
    const wish = readList("wish");
    if (cart.length) writeJson(`flowerCart_${uid}`, cart); else remove(`flowerCart_${uid}`);
    if (wish.length) writeJson(`flowerWish_${uid}`, wish); else remove(`flowerWish_${uid}`);
    ["cart", "wish", "flowerCheckout", "flowerSelectedPromotion", "flowerPaymentReference", "flowerPendingOrder"].forEach((key) => remove(key));
  }

  function bringBack(uid) {
    const cart = mergeCarts(readList(`flowerCart_${uid}`), readList("cart"));
    const wish = mergeWishlists(readList(`flowerWish_${uid}`), readList("wish"));
    if (cart.length) writeJson("cart", cart);
    if (wish.length) writeJson("wish", wish);
    remove(`flowerCart_${uid}`);
    remove(`flowerWish_${uid}`);
  }

  function syncShoppingOwner() {
    let account = null;
    try {
      account = JSON.parse(root.localStorage.getItem("loggedUser") || "null");
    } catch {
      account = null;
    }
    const uid = String(account?.uid || "");
    let owner;
    try {
      owner = root.localStorage.getItem(OWNER_KEY);
    } catch {
      return;
    }
    // First run after this feature shipped: the current lists belong to whoever is signed in.
    if (owner === null) {
      writeText(OWNER_KEY, uid);
      return;
    }
    if (owner === uid) return;
    if (owner) putAway(owner);
    if (uid) bringBack(uid);
    writeText(OWNER_KEY, uid);
  }

  syncShoppingOwner();
  root.FlowerSafeStorage.syncShoppingOwner = syncShoppingOwner;
})(typeof globalThis !== "undefined" ? globalThis : this);
