(function initializeReviewStore(root) {
  let firebasePromise;

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

  function subscribe(productId, onReviews, onError = () => {}) {
    let unsubscribe = null;
    let cancelled = false;

    getFirebase().then(({ db, firestoreSdk }) => {
      if (cancelled) return;
      const reviewsQuery = firestoreSdk.query(
        firestoreSdk.collection(db, "reviews"),
        firestoreSdk.where("productIds", "array-contains", String(productId)),
        firestoreSdk.where("moderationStatus", "==", "approved")
      );
      unsubscribe = firestoreSdk.onSnapshot(reviewsQuery, (snapshot) => {
        const reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((review) => review.moderationStatus === "approved");
        reviews.sort((first, second) => {
          const firstDate = first.createdAt?.toMillis?.() || 0;
          const secondDate = second.createdAt?.toMillis?.() || 0;
          return secondDate - firstDate;
        });
        onReviews(reviews);
      }, onError);
    }).catch(onError);

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }

  // Sent to the server, which takes the products and the shown name from the order itself.
  async function submit(review) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) {
      throw new Error("Đăng nhập tài khoản khách hàng để gửi đánh giá công khai.");
    }
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`
      },
      body: JSON.stringify({
        action: "review",
        orderId: String(review.orderId || ""),
        rating: Number(review.rating),
        comment: String(review.comment || "").trim(),
        photos: review.photos || []
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "Chưa thể gửi đánh giá. Hãy thử lại sau.");
      error.code = result.code || "review-failed";
      throw error;
    }
    return result.review.id;
  }

  // The public review of one order (see reviewIdForOrder in api/orders.js), or null.
  async function getForOrder(orderId) {
    const { auth } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) throw new Error("Đăng nhập để xem đánh giá của bạn.");
    const response = await fetch("/api/orders", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
      body: JSON.stringify({ action: "review-get", orderId: String(orderId) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Chưa tải được đánh giá.");
    return result.review;
  }

  function serializeReview(doc) {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString() || data.createdAt || ""
    };
  }

  async function migrateLegacyAdminReviews(reviews = []) {
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) throw new Error("Cần quyền quản trị.");
    for (const review of Array.isArray(reviews) ? reviews : []) {
      const id = String(review?.id || "");
      if (!id || id.includes("/")) continue;
      const reference = firestoreSdk.doc(db, "reviews", id);
      const existing = await firestoreSdk.getDoc(reference);
      if (!existing.exists()) continue; // Never create customer content from an admin's local cache.
      const changes = {};
      if (String(review.reply || "").trim()) changes.reply = String(review.reply).slice(0, 1000);
      if (review.completedAt) changes.completedAt = review.completedAt;
      if (Object.keys(changes).length) await firestoreSdk.updateDoc(reference, changes);
    }
  }

  // Admin only (Security Rules): every review, newest first.
  function subscribeAll(onReviews, onError = () => {}) {
    let unsubscribe = null;
    let cancelled = false;

    getFirebase().then(({ db, firestoreSdk }) => {
      if (cancelled) return;
      unsubscribe = firestoreSdk.onSnapshot(firestoreSdk.collection(db, "reviews"), (snapshot) => {
        onReviews(snapshot.docs.map(serializeReview).sort(
          (first, second) => String(second.createdAt).localeCompare(String(first.createdAt))
        ));
      }, onError);
    }).catch(onError);

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }

  async function update(id, changes) {
    const allowed = ["reply", "completedAt", "moderationStatus", "moderationReason"];
    if (!changes || Object.keys(changes).some((key) => !allowed.includes(key))) {
      throw new Error("Không được sửa nội dung, số sao hoặc ảnh của khách hàng.");
    }
    if (changes.moderationStatus && !["approved", "hidden", "pending"].includes(changes.moderationStatus)) throw new Error("Trạng thái kiểm duyệt không hợp lệ.");
    const { auth, db, firestoreSdk } = await getFirebase();
    await auth.authStateReady();
    const reviewChanges = { ...changes };
    if (reviewChanges.completedAt === null) reviewChanges.completedAt = firestoreSdk.deleteField();
    if (reviewChanges.moderationStatus) {
      if (!auth.currentUser) throw new Error("Cần quyền quản trị.");
      reviewChanges.moderatedBy = auth.currentUser.uid;
      reviewChanges.moderatedAt = firestoreSdk.serverTimestamp();
    }
    await firestoreSdk.updateDoc(firestoreSdk.doc(db, "reviews", String(id)), reviewChanges);
  }
  async function remove(id) {
    return update(id, { moderationStatus: "hidden" });
  }
  const photoCache = new Map();
  function photoUrl(id) { return "/api/review-images?id=" + encodeURIComponent(id); }
  async function loadPhotos(review) {
    if (photoCache.has(review.id)) return photoCache.get(review.id);
    const request = (async () => {
      const { auth } = await getFirebase();
      await auth.authStateReady();
      const headers = {};
      if (auth.currentUser) headers.Authorization = "Bearer " + await auth.currentUser.getIdToken();
      return Promise.all((review.photoIds || []).map(async (id) => {
        const response = await fetch(photoUrl(id), { headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("Chưa tải được ảnh đánh giá.");
        return URL.createObjectURL(await response.blob());
      }));
    })();
    photoCache.set(review.id, request);
    try { return await request; } catch (error) { photoCache.delete(review.id); throw error; }
  }
  root.addEventListener?.("pagehide", () => {
    photoCache.forEach((request) => request.then((urls) => urls.forEach((url) => URL.revokeObjectURL(url))).catch(() => {}));
    photoCache.clear();
  });
  root.FlowerReviewStore = { subscribe, submit, getForOrder, subscribeAll, migrateLegacyAdminReviews, update, remove, photoUrl, loadPhotos };
})(typeof window !== "undefined" ? window : globalThis);
