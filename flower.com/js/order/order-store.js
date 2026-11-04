(function initializeFlowerOrderStore(root) {
  let firebasePromise;

  async function orderRequest(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const { url, ...requestOptions } = options;
      const response = await fetch(url || "/api/orders", { ...requestOptions, signal: controller.signal });
      const result = await response.json();
      return { response, result };
    } catch (cause) {
      const error = new Error("Không nhận được phản hồi từ API đơn hàng. Kiểm tra kết nối rồi thử lại.");
      error.code = "order-network-error";
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function paymentRequest(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(options.url || "/api/payments", {
        method: options.method || "GET",
        headers: options.headers || { Accept: "application/json" },
        ...(options.body ? { body: options.body } : {}),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Không thể xử lý thanh toán.");
        error.code = result.code || "payment-service-unavailable";
        throw error;
      }
      return result;
    } catch (cause) {
      if (typeof cause?.code === "string") throw cause;
      const error = new Error("Không nhận được phản hồi từ dịch vụ thanh toán. Vui lòng thử lại.");
      error.code = "payment-network-error";
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function paymentUrlFrom(result) {
    let url;
    try {
      url = new URL(result.paymentUrl);
    } catch {
      throw new Error("Dịch vụ thanh toán trả về liên kết không hợp lệ.");
    }
    if (![
      "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      "https://pay.vnpay.vn/vpcpay.html"
    ].includes(`${url.origin}${url.pathname}`)) {
      throw new Error("Dịch vụ thanh toán trả về liên kết không được phép.");
    }
    return url.toString();
  }

  async function createPaymentLink(orderId, paymentReference) {
    const result = await paymentRequest({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "create", orderId, paymentReference })
    });
    return { paymentUrl: paymentUrlFrom(result), expiresAt: result.expiresAt };
  }

  async function retryPaymentLink(txnRef) {
    const result = await paymentRequest({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "retry", txnRef })
    });
    return { paymentUrl: paymentUrlFrom(result), expiresAt: result.expiresAt };
  }

  async function getPaymentStatus(txnRef) {
    return paymentRequest({ url: `/api/payments?action=status&txnRef=${encodeURIComponent(txnRef)}` });
  }

  async function deliveryZonesRequest(options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(options.manage ? "/api/delivery-zones?manage=1" : "/api/delivery-zones", {
        method: options.method || "GET",
        headers: options.headers || { Accept: "application/json" },
        body: options.body,
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Không thể tải cấu hình khu vực giao hàng.");
        error.code = result.code || "delivery-zone-service-unavailable";
        throw error;
      }
      return result;
    } catch (cause) {
      if (cause.code) throw cause;
      const error = new Error("Không kết nối được với cấu hình khu vực giao hàng. Vui lòng thử lại.");
      error.code = "delivery-zone-network-error";
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getFirebase() {
    if (!firebasePromise) {
      firebasePromise = (async () => {
        const [configModule, appSdk, authSdk, firestoreSdk] = await Promise.all([
          import("../core/firebase-config.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
        ]);
        const app = appSdk.getApps().length
          ? appSdk.getApp()
          : appSdk.initializeApp(configModule.firebaseConfig);
        const auth = authSdk.getAuth(app);
        const db = firestoreSdk.getFirestore(app);
        configModule.connectFirebaseEmulators(app, auth, db, authSdk, firestoreSdk);
        return {
          auth,
          db,
          firestoreSdk
        };
      })().catch((error) => {
        firebasePromise = null;
        throw error;
      });
    }
    return firebasePromise;
  }

  function serializeDocument(document) {
    const data = document.data();
    return {
      id: document.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString() || data.createdAt || "",
      trackingHistory: Array.isArray(data.trackingHistory)
        ? data.trackingHistory.map((event) => ({
            ...event,
            updatedAt: event.updatedAt?.toDate?.().toISOString() || event.updatedAt || ""
          }))
        : []
    };
  }

  function aggregateOrderItems(items) {
    const quantities = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const id = String(item?.productId ?? item?.id ?? "");
      const quantity = Math.max(1, Number(item?.quantity) || 1);
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    });
    return Array.from(quantities, ([id, quantity]) => ({ id, quantity }));
  }

  async function create(order, expectedTotals) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    // A browser that still shows an account whose Firebase session is gone would otherwise
    // place a guest order that never appears under "Đơn hàng của bạn".
    const storedAccount = root.FlowerSafeStorage?.readJson("loggedUser", { fallback: null }) || null;
    if (storedAccount?.uid && auth.currentUser?.uid !== storedAccount.uid) {
      root.FlowerSafeStorage.remove("loggedUser");
      const error = new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để đơn được lưu vào tài khoản của bạn (giỏ hàng vẫn được giữ).");
      error.code = "session-expired";
      throw error;
    }
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    const { response, result } = await orderRequest({
      method: "POST",
      headers,
      body: JSON.stringify({
        customerName: order.customerName,
        phone: order.phone,
        address: order.address,
        recipientName: order.recipientName || order.customerName,
        recipientPhone: order.recipientPhone || order.phone,
        customerIsRecipient: order.customerIsRecipient === true,
        deliveryDate: order.deliveryDate || "",
        deliveryTime: order.deliveryTime || "",
        deliveryZoneId: order.deliveryZoneId || "",
        greetingCard: order.greetingCard || "",
        anonymousGreetingCard: order.anonymousGreetingCard === true,
        giftWrap: order.giftWrap || "none",
        orderNote: order.orderNote || "",
        paymentMethod: order.paymentMethod,
        idempotencyKey: order.idempotencyKey || "",
        promotionId: order.promotionId || "",
        expectedTotals,
        items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
          id: item.id, productId: item.productId, size: item.size, color: item.color, cardMessage: item.cardMessage, personalNote: item.personalNote,
          quantity: item.quantity
        }))
      })
    });
    if (!response.ok) {
      const error = new Error(result.error || "Không thể xác nhận đơn hàng.");
      error.code = result.code || "order-create-failed";
      throw error;
    }
    if (typeof result.order?.id !== "string" || !result.order.id) {
      const error = new Error("Chưa nhận được mã đơn. Hãy thử lại cùng yêu cầu đặt hàng.");
      error.code = "order-network-error";
      throw error;
    }
    return result.order.id;
  }

  async function quote(items, promotionId = "", deliveryZoneId = "") {
    const { response, result } = await orderRequest({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "quote",
        items: (Array.isArray(items) ? items : []).map((item) => ({ id: item.id, productId: item.productId, size: item.size, color: item.color, cardMessage: item.cardMessage, personalNote: item.personalNote, quantity: item.quantity })),
        promotionId: promotionId || "",
        deliveryZoneId: deliveryZoneId || ""
      })
    });
    if (!response.ok) {
      const error = new Error(result.error || "Không thể kiểm tra giá sản phẩm.");
      error.code = result.code || "order-quote-failed";
      error.items = Array.isArray(result.items) ? result.items : [];
      throw error;
    }
    return result;
  }

  async function getDeliveryZones(manage = false) {
    const options = { manage };
    if (manage) {
      const { auth } = await getFirebase();
      await auth.authStateReady();
      if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
        throw new Error("Chỉ quản trị viên mới được quản lý khu vực giao hàng.");
      }
      options.headers = {
        Accept: "application/json",
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`
      };
    }
    return deliveryZonesRequest(options);
  }

  async function updateDeliveryZone(action, payload) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Chỉ quản trị viên mới được thay đổi khu vực giao hàng.");
    }
    return deliveryZonesRequest({
      method: "POST",
      manage: true,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`
      },
      body: JSON.stringify({ action, ...payload })
    });
  }

  async function saveDeliveryZone(zone) {
    return updateDeliveryZone("upsert", { zone });
  }

  async function deleteDeliveryZone(id) {
    return updateDeliveryZone("delete", { id });
  }

  async function getPromotions() {
    const { db, firestoreSdk } = await getFirebase();
    const snapshot = await firestoreSdk.getDoc(firestoreSdk.doc(db, "metadata", "activePromotions"));
    return snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
  }

  async function savePromotions(promotions) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Chỉ quản trị viên mới được thay đổi ưu đãi.");
    }
    await firestoreSdk.setDoc(firestoreSdk.doc(db, "metadata", "activePromotions"), {
      items: Array.isArray(promotions) ? promotions : [],
      updatedAt: firestoreSdk.serverTimestamp()
    });
    return getPromotions();
  }

  // Applies change(items) to the latest promotions inside a transaction, so two admins
  // editing at the same time never overwrite each other's promotions.
  async function updatePromotions(change) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Chỉ quản trị viên mới được thay đổi ưu đãi.");
    }
    const reference = firestoreSdk.doc(db, "metadata", "activePromotions");
    return firestoreSdk.runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
      const items = change(current.map((item) => ({ ...item })));
      transaction.set(reference, { items, updatedAt: firestoreSdk.serverTimestamp() });
      return items;
    });
  }

  async function subscribePromotions(onPromotions, onError = () => {}) {
    const { db, firestoreSdk } = await getFirebase();
    return firestoreSdk.onSnapshot(firestoreSdk.doc(db, "metadata", "activePromotions"), (snapshot) => {
      onPromotions(snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : []);
    }, onError);
  }

  // Admin-defined categories, kept even when no product uses them yet.
  async function getCategories() {
    const { db, firestoreSdk } = await getFirebase();
    const snapshot = await firestoreSdk.getDoc(firestoreSdk.doc(db, "metadata", "storeCategories"));
    return snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : null;
  }

  async function saveCategories(categories) {
    const { db, firestoreSdk } = await getFirebase();
    await firestoreSdk.setDoc(firestoreSdk.doc(db, "metadata", "storeCategories"), {
      items: Array.isArray(categories) ? categories : [],
      updatedAt: firestoreSdk.serverTimestamp()
    });
  }

  async function initializePromotions(legacyPromotions = []) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Cần quyền quản trị để khởi tạo danh sách ưu đãi.");
    }
    const reference = firestoreSdk.doc(db, "metadata", "activePromotions");
    const snapshot = await firestoreSdk.getDoc(reference);
    if (snapshot.exists()) return Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
    const promotions = Array.isArray(legacyPromotions) ? legacyPromotions : [];
    await firestoreSdk.setDoc(reference, {
      items: promotions,
      updatedAt: firestoreSdk.serverTimestamp()
    });
    return promotions;
  }

  async function subscribeAdmin(onOrders, onError) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) throw new Error("Đăng nhập tài khoản quản trị để xem đơn hàng.");
    const token = await auth.currentUser.getIdTokenResult();
    if (token.claims.admin !== true) throw new Error("Tài khoản hiện tại không có quyền quản trị.");

    const ordersQuery = firestoreSdk.query(
      firestoreSdk.collection(db, "orders"),
      firestoreSdk.orderBy("createdAt", "desc")
    );
    return firestoreSdk.onSnapshot(ordersQuery, (snapshot) => {
      onOrders(snapshot.docs.map(serializeDocument));
    }, onError);
  }

  async function subscribeAccount(uid, onOrders, onError) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error("Phiên đăng nhập không khớp với tài khoản cần tra cứu.");
    }
    const ordersQuery = firestoreSdk.query(
      firestoreSdk.collection(db, "orders"),
      firestoreSdk.where("uid", "==", uid)
    );
    return firestoreSdk.onSnapshot(ordersQuery, (snapshot) => {
      onOrders(snapshot.docs.map(serializeDocument).sort(
        (first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0)
      ));
    }, onError);
  }

  async function getPublicOrder(id, phone) {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "lookup", id: String(id), phone: String(phone) }),
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "Không thể tra cứu đơn hàng.");
      error.code = result.code || "order-lookup-failed";
      throw error;
    }
    return result.order;
  }

  async function expireReservations() {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) throw new Error("Cần đăng nhập quản trị để dọn đơn hết hạn.");
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/orders?action=expire", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Không thể dọn đơn giữ hàng hết hạn.");
    return result.released || 0;
  }

  // Where an order's items are: "reserved" (taken from stock, not yet delivered),
  // "sold" (delivered) or "released" (back in stock). Older orders only have inventoryReserved.
  function inventoryStateOf(order) {
    if (["reserved", "sold", "released"].includes(order.inventoryState)) return order.inventoryState;
    if (order.inventoryReserved === true) return "reserved";
    return order.status === "Đã giao" ? "sold" : "released";
  }

  // options.restockSold: when cancelling an order that was already delivered, put its items
  // back in stock (the goods came back). Otherwise a delivered order stays counted as sold.
  // options.expectedStatus: the status the admin was looking at; if the order changed since
  // (e.g. the reservation expired), nothing is written and the admin is asked to look again.
  // options.newEvent: tracking event appended to the latest history inside the transaction.
  async function update(id, changes, options = {}) {
    const { db, firestoreSdk } = await getFirebase();
    const orderRef = firestoreSdk.doc(db, "orders", String(id));
    if (!Object.prototype.hasOwnProperty.call(changes || {}, "status")) {
      await firestoreSdk.updateDoc(orderRef, changes);
      return;
    }

    await firestoreSdk.runTransaction(db, async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists()) throw new Error("Không tìm thấy đơn hàng.");
      const order = orderSnapshot.data();
      if (options.expectedStatus !== undefined && order.status !== options.expectedStatus) {
        const error = new Error(`Đơn hàng vừa được cập nhật thành “${order.status}”. Hãy xem lại đơn trước khi đổi trạng thái.`);
        error.code = "order-changed";
        throw error;
      }
      if (options.newEvent) {
        changes = {
          ...changes,
          trackingHistory: [...(Array.isArray(order.trackingHistory) ? order.trackingHistory : []), options.newEvent]
        };
      }
      const state = inventoryStateOf(order);
      const willBeCancelled = changes.status === "Đã hủy";
      const willBeDelivered = changes.status === "Đã giao";

      let stockChange = 0;
      let nextState = state;
      if (willBeCancelled) {
        if (state === "reserved" || (state === "sold" && options.restockSold === true)) {
          stockChange = 1;
          nextState = "released";
        }
      } else if (state === "released") {
        stockChange = -1;
        nextState = willBeDelivered ? "sold" : "reserved";
      } else {
        nextState = willBeDelivered ? "sold" : "reserved";
      }

      const items = aggregateOrderItems(order.items);
      const salesChange = root.FlowerProductSales.adjustment(order, changes.status, options.restockSold);
      const productRefs = stockChange || salesChange
        ? items.map((item) => firestoreSdk.doc(db, "products", String(item.id)))
        : [];
      const productSnapshots = [];
      for (const productRef of productRefs) productSnapshots.push(await transaction.get(productRef));

      if (stockChange < 0) {
        const shortages = productSnapshots.map((snapshot, index) => {
          const available = snapshot.exists() ? Number(snapshot.data().quantity) : 0;
          if (Number.isInteger(available) && available >= Number(items[index].quantity)) return "";
          const orderItem = (order.items || []).find((item) => String(item?.id) === items[index].id);
          const title = (snapshot.exists() && snapshot.data().title) || orderItem?.title || `#${items[index].id}`;
          return `${title} (cần ${items[index].quantity}, còn ${Number.isInteger(available) ? Math.max(0, available) : 0})`;
        }).filter(Boolean);
        if (shortages.length) {
          const error = new Error(`Không đủ tồn kho để khôi phục đơn đã hủy: ${shortages.join("; ")}. Hãy nhập thêm hàng rồi thử lại.`);
          error.code = "insufficient-stock";
          throw error;
        }
      }
      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) return;
        const quantity = Number(snapshot.data().quantity) || 0;
        const orderQuantity = Math.max(1, Number(items[index].quantity) || 1);
        transaction.update(snapshot.ref, {
          ...(stockChange ? { quantity: quantity + stockChange * orderQuantity } : {}),
          ...(salesChange ? { soldCount: Math.max(0, (Number(snapshot.data().soldCount) || 0) + salesChange * orderQuantity) } : {})
        });
      });

      // The hold timer only applies while the order waits for confirmation.
      const waitsForConfirmation = changes.status === "Chờ xác nhận";
      const reserveAgain = state === "released" && nextState === "reserved" && waitsForConfirmation;
      transaction.update(orderRef, {
        ...changes,
        ...(salesChange ? { salesCounted: salesChange > 0 } : {}),
        inventoryState: nextState,
        inventoryReserved: nextState === "reserved",
        // A restored QR order is waiting for the transfer again, not "expired".
        ...(reserveAgain && order.paymentMethod === "qr"
          ? { paymentStatus: order.paymentVerified === true ? "Đã thanh toán" : "Chờ xác minh thanh toán" }
          : {}),
        ...(reserveAgain ? {
          reservationExpiresAt: firestoreSdk.Timestamp.fromDate(new Date(Date.now() + (
            order.paymentMethod === "qr" ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000
          ))),
          reservationExpiredAt: firestoreSdk.deleteField()
        } : {}),
        ...(!waitsForConfirmation ? { reservationExpiresAt: firestoreSdk.deleteField() } : {})
      });
    });
  }

  async function reconcileQrPayment(action, id, reconciliation) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) {
      const error = new Error("Đăng nhập tài khoản quản trị để xác nhận thanh toán.");
      error.code = "unauthenticated";
      throw error;
    }
    const token = await auth.currentUser.getIdToken();
    const { response, result } = await orderRequest({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        action,
        orderId: String(id),
        amount: reconciliation.amount,
        reconciliationReference: reconciliation.reconciliationReference
      })
    });
    if (!response.ok) {
      const error = new Error(result.error || "Chưa thể ghi nhận đối soát thanh toán.");
      error.code = result.code || "payment-reconciliation-unavailable";
      throw error;
    }
    return result;
  }

  function verifyPayment(id, reconciliation) {
    return reconcileQrPayment("verify-qr-payment", id, reconciliation);
  }

  function recordLatePayment(id, reconciliation) {
    return reconcileQrPayment("record-late-qr-payment", id, reconciliation);
  }

  async function getPaymentAudit(id) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) {
      const error = new Error("Đăng nhập tài khoản quản trị để xem lịch sử đối soát.");
      error.code = "unauthenticated";
      throw error;
    }
    const token = await auth.currentUser.getIdToken();
    const { response, result } = await orderRequest({
      url: `/api/orders?action=payment-audit&orderId=${encodeURIComponent(String(id))}`,
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const error = new Error(result.error || "Chưa thể tải lịch sử đối soát.");
      error.code = result.code || "payment-audit-unavailable";
      throw error;
    }
    return result.entries;
  }

  async function remove(id) {
    const { db, firestoreSdk } = await getFirebase();
    const orderRef = firestoreSdk.doc(db, "orders", String(id));
    await firestoreSdk.runTransaction(db, async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists()) return;
      const order = orderSnapshot.data();
      const items = aggregateOrderItems(order.items);
      const productRefs = order.inventoryReserved === true
        ? items.map((item) => firestoreSdk.doc(db, "products", String(item.id)))
        : [];
      const productSnapshots = [];
      for (const productRef of productRefs) productSnapshots.push(await transaction.get(productRef));
      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) return;
        const quantity = Number(snapshot.data().quantity) || 0;
        const orderQuantity = Math.max(1, Number(items[index].quantity) || 1);
        transaction.update(snapshot.ref, { quantity: quantity + orderQuantity });
      });
      transaction.delete(orderRef);
    });
  }

  root.FlowerOrderStore = {
    create,
    createPaymentLink,
    retryPaymentLink,
    getPaymentStatus,
    quote,
    getPromotions,
    getDeliveryZones,
    saveDeliveryZone,
    deleteDeliveryZone,
    savePromotions,
    initializePromotions,
    updatePromotions,
    subscribePromotions,
    getCategories,
    saveCategories,
    subscribeAdmin,
    subscribeAccount,
    getPublicOrder,
    expireReservations,
    update,
    verifyPayment,
    recordLatePayment,
    getPaymentAudit,
    remove
  };
})(typeof window !== "undefined" ? window : globalThis);
