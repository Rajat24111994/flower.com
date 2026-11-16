const MAX_LIST_ITEMS = 100;
const MAX_CART_QUANTITY = 50;
const MAX_DOCUMENT_BYTES = 700 * 1024;
const ITEM_FIELDS = [
  "id", "productId", "title", "name", "price", "quantity", "stockQuantity", "image", "images",
  "description", "category", "categoryKey", "sameDayDelivery", "onSale", "status",
  "size", "color", "cardMessage", "personalNote"
];
const STRING_LIMITS = {
  id: 128,
  productId: 128,
  title: 120,
  name: 120,
  image: 2048,
  description: 1000,
  category: 120,
  categoryKey: 120,
  status: 30,
  size: 20,
  color: 20,
  cardMessage: 300,
  personalNote: 500
};

function shoppingDataError(message, code = "invalid-shopping-data") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeShoppingList(items, kind) {
  if (!["cart", "wish"].includes(kind) || !Array.isArray(items)) {
    throw shoppingDataError("Dữ liệu giỏ hàng hoặc yêu thích không hợp lệ.");
  }
  if (items.length > MAX_LIST_ITEMS) {
    throw shoppingDataError("Danh sách mua sắm đã đạt giới hạn 100 sản phẩm.", "shopping-list-limit");
  }
  const ids = new Set();
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw shoppingDataError("Sản phẩm trong danh sách mua sắm không hợp lệ.");
    }
    if (item.id !== undefined && typeof item.id !== "string"
      && !(typeof item.id === "number" && Number.isSafeInteger(item.id))) {
      throw shoppingDataError("Mã sản phẩm trong danh sách mua sắm không hợp lệ.");
    }
    const id = String(item.id ?? "").trim();
    if (!id || id.length > 128 || ids.has(id)) {
      throw shoppingDataError("Mã sản phẩm trong danh sách mua sắm không hợp lệ.");
    }
    ids.add(id);
    const result = {};
    for (const field of ITEM_FIELDS) {
      if (item[field] === undefined || item[field] === null) continue;
      const value = item[field];
      if (STRING_LIMITS[field]) {
        const identifier = field === "id" || field === "productId";
        if (identifier && typeof value !== "string"
          && !(typeof value === "number" && Number.isSafeInteger(value))) {
          throw shoppingDataError(`Thông tin ${field} của sản phẩm không hợp lệ.`);
        }
        const text = identifier ? String(value) : value;
        if (typeof text !== "string" || text.length > STRING_LIMITS[field]) {
          throw shoppingDataError(`Thông tin ${field} của sản phẩm không hợp lệ.`);
        }
        result[field] = identifier && typeof value === "number" ? value : text;
      } else if (field === "images") {
        if (!Array.isArray(value) || value.length > 8
          || value.some((image) => typeof image !== "string" || image.length > 2048)) {
          throw shoppingDataError("Danh sách ảnh sản phẩm không hợp lệ.");
        }
        result[field] = [...value];
      } else if (["sameDayDelivery", "onSale"].includes(field)) {
        if (typeof value !== "boolean") throw shoppingDataError(`Thông tin ${field} không hợp lệ.`);
        result[field] = value;
      } else {
        const number = Number(value);
        const minimum = field === "quantity" && kind === "wish" ? 0 : field === "quantity" ? 1 : 0;
        const maximum = field === "quantity" && kind === "cart" ? MAX_CART_QUANTITY : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
          throw shoppingDataError(`Giá trị ${field} của sản phẩm không hợp lệ.`);
        }
        result[field] = number;
      }
    }
    result.id = id;
    return result;
  });
}

function mergeInitialData(remote = {}, local = {}) {
  const remoteCart = normalizeShoppingList(remote.cart || [], "cart");
  const localCart = normalizeShoppingList(local.cart || [], "cart");
  const remoteWish = normalizeShoppingList(remote.wish || [], "wish");
  const localWish = normalizeShoppingList(local.wish || [], "wish");
  const cart = remoteCart.map((item) => ({ ...item }));

  localCart.forEach((item) => {
    const existing = cart.find((entry) => entry.id === item.id);
    if (!existing) cart.push(item);
    else existing.quantity = Math.max(Number(existing.quantity) || 1, Number(item.quantity) || 1);
  });

  const wish = remoteWish.map((item) => ({ ...item }));
  const wishIds = new Set(wish.map((item) => item.id));
  localWish.forEach((item) => {
    if (!wishIds.has(item.id)) {
      wish.push(item);
      wishIds.add(item.id);
    }
  });
  return normalizeShoppingData({
    cart: normalizeShoppingList(cart, "cart"),
    wish: normalizeShoppingList(wish, "wish")
  });
}

function normalizeShoppingData(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw shoppingDataError("Dữ liệu đồng bộ mua sắm không hợp lệ.");
  }
  const result = {
    cart: normalizeShoppingList(data.cart || [], "cart"),
    wish: normalizeShoppingList(data.wish || [], "wish")
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_DOCUMENT_BYTES) {
    throw shoppingDataError("Giỏ hàng và danh sách yêu thích vượt dung lượng đồng bộ cho phép.", "shopping-data-too-large");
  }
  return result;
}

function readList(storage, key, kind) {
  let value;
  try {
    value = storage.getItem(key);
    if (value === null) return [];
    return normalizeShoppingList(JSON.parse(value), kind);
  } catch (error) {
    if (error.code) throw error;
    throw shoppingDataError("Không thể đọc dữ liệu mua sắm đã lưu.");
  }
}

function sameShoppingData(left, right) {
  return JSON.stringify(left.cart) === JSON.stringify(right.cart)
    && JSON.stringify(left.wish) === JSON.stringify(right.wish);
}

export function startShoppingSync({ uid, db, firestoreSdk, storage = window.localStorage, eventTarget = window }) {
  if (!uid || !db || !firestoreSdk) throw new TypeError("Thiếu thông tin để đồng bộ giỏ hàng.");
  const { doc, onSnapshot, setDoc } = firestoreSdk;
  const cartRef = doc(db, "shoppingCarts", String(uid));
  let stopped = false;
  let firstSnapshot = true;
  let applyingRemote = false;
  let localChangePending = false;
  let localDirty = false;
  let localRevision = 0;
  let pendingWrites = 0;
  let writeChain = Promise.resolve();
  let timer = null;
  let unsubscribe = () => {};
  const status = (detail) => {
    const EventConstructor = eventTarget.CustomEvent || globalThis.CustomEvent;
    if (typeof EventConstructor === "function") {
      eventTarget.dispatchEvent(new EventConstructor("flowershoppingsync", { detail }));
    }
  };

  function localData() {
    return normalizeShoppingData({
      cart: readList(storage, "cart", "cart"),
      wish: readList(storage, "wish", "wish")
    });
  }

  function applyLocal(data) {
    applyingRemote = true;
    try {
      storage.setItem("cart", JSON.stringify(data.cart));
      storage.setItem("wish", JSON.stringify(data.wish));
      for (const key of ["cart", "wish"]) {
        const EventConstructor = eventTarget.CustomEvent || globalThis.CustomEvent;
        if (typeof EventConstructor === "function") {
          eventTarget.dispatchEvent(new EventConstructor("flowerstoragechange", {
            detail: { key, source: "sync" }
          }));
        }
      }
    } finally {
      applyingRemote = false;
    }
  }

  async function saveToCloud(data) {
    if (stopped) return;
    localDirty = true;
    const revision = localRevision;
    localChangePending = true;
    status({ state: "syncing" });
    pendingWrites += 1;
    try {
      const payload = normalizeShoppingData(data === undefined ? localData() : data);
      const write = writeChain.catch(() => {}).then(() => setDoc(cartRef, payload));
      writeChain = write;
      await write;
      if (revision === localRevision) localDirty = false;
      status({ state: localDirty ? "syncing" : "synced" });
    } catch (error) {
      status({ state: "error", error });
    } finally {
      pendingWrites -= 1;
      localChangePending = pendingWrites > 0 || timer !== null || localDirty;
    }
  }

  function scheduleSave() {
    if (stopped || applyingRemote) return;
    localRevision += 1;
    localDirty = true;
    localChangePending = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveToCloud();
    }, 250);
  }

  unsubscribe = onSnapshot(cartRef, (snapshot) => {
    if (stopped || localChangePending || localDirty) return;
    try {
      const remote = snapshot.exists() ? snapshot.data() : { cart: [], wish: [] };
      const normalizedRemote = normalizeShoppingData(remote);
      if (firstSnapshot) {
        firstSnapshot = false;
        const merged = mergeInitialData(normalizedRemote, localData());
        if (!sameShoppingData(merged, localData())) applyLocal(merged);
        if (!snapshot.exists() || !sameShoppingData(merged, normalizedRemote)) {
          void saveToCloud(merged);
        } else {
          status({ state: "synced" });
        }
        return;
      }
      if (!sameShoppingData(normalizedRemote, localData())) {
        applyLocal(normalizedRemote);
        status({ state: "synced" });
      }
    } catch (error) {
      status({ state: "error", error });
    }
  }, (error) => status({ state: "error", error }));

  const onStorageChange = (event) => {
    const key = event.key ?? event.detail?.key ?? null;
    if (key === "cart" || key === "wish" || key === null) scheduleSave();
  };
  status({ state: "syncing" });
  eventTarget.addEventListener("flowerstoragechange", onStorageChange);
  eventTarget.addEventListener("storage", onStorageChange);
  eventTarget.addEventListener("online", scheduleSave);

  return function stopShoppingSync() {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    eventTarget.removeEventListener("flowerstoragechange", onStorageChange);
    eventTarget.removeEventListener("storage", onStorageChange);
    eventTarget.removeEventListener("online", scheduleSave);
  };
}

export const internals = {
  normalizeShoppingList,
  normalizeShoppingData,
  mergeInitialData,
  MAX_LIST_ITEMS,
  MAX_CART_QUANTITY,
  MAX_DOCUMENT_BYTES
};
