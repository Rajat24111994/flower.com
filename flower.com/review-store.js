(function initializeReviewStore(root) {
  let firebasePromise;

  async function getFirebase() {
    if (!firebasePromise) {
      firebasePromise = (async () => {
        const [{ firebaseConfig }, appSdk, authSdk, firestoreSdk] = await Promise.all([
          import("./firebase-config.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
        ]);
        const app = appSdk.getApps().length
          ? appSdk.getApp()
          : appSdk.initializeApp(firebaseConfig);
        return {
          auth: authSdk.getAuth(app),
          db: firestoreSdk.getFirestore(app),
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
        firestoreSdk.where("productIds", "array-contains", String(productId))
      );
      unsubscribe = firestoreSdk.onSnapshot(reviewsQuery, (snapshot) => {
        const reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
        rating: Math.max(1, Math.min(5, Math.round(Number(review.rating) || 0))),
        comment: String(review.comment || "").trim()
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
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`review:${orderId}`));
    const id = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 40);
    const { db, firestoreSdk } = await getFirebase();
    const snapshot = await firestoreSdk.getDoc(firestoreSdk.doc(db, "reviews", id));
    return snapshot.exists() ? serializeReview(snapshot) : null;
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
    if (!auth.currentUser || (await auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Chỉ quản trị viên mới được chuyển đánh giá cũ.");
    }
    for (const review of Array.isArray(reviews) ? reviews : []) {
      if (!review || !Array.isArray(review.productIds) || !review.productIds.length) continue;
      const id = String(review.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      if (!id) continue;
      const reference = firestoreSdk.doc(db, "reviews", id);
      const existing = await firestoreSdk.getDoc(reference);
      const adminFields = {};
      if (String(review.reply || "").trim()) adminFields.reply = String(review.reply).slice(0, 1000);
      if (review.completedAt) adminFields.completedAt = review.completedAt;
      if (existing.exists()) {
        if (Object.keys(adminFields).length) await firestoreSdk.updateDoc(reference, adminFields);
        continue;
      }

      const productIds = [...new Set(review.productIds.map(String).filter(Boolean))].slice(0, 10);
      const comment = String(review.comment || "").trim().slice(0, 1000);
      if (!productIds.length || !comment) continue;
      const createdAt = new Date(review.createdAt || 0);
      await firestoreSdk.setDoc(reference, {
        productIds,
        productName: String(review.productName || "Sản phẩm hoa").slice(0, 500),
        customerName: String(review.customerName || "Khách hàng").slice(0, 80),
        rating: Math.max(1, Math.min(5, Math.round(Number(review.rating) || 0))),
        comment,
        createdAt: Number.isNaN(createdAt.getTime()) ? firestoreSdk.serverTimestamp() : createdAt,
        ...(review.orderId ? { orderId: String(review.orderId).slice(0, 100) } : {}),
        ...adminFields
      });
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
    const { db, firestoreSdk } = await getFirebase();
    const reviewChanges = { ...changes };
    if (reviewChanges.completedAt === null) reviewChanges.completedAt = firestoreSdk.deleteField();
    await firestoreSdk.updateDoc(firestoreSdk.doc(db, "reviews", String(id)), reviewChanges);
  }

  async function remove(id) {
    const { db, firestoreSdk } = await getFirebase();
    await firestoreSdk.deleteDoc(firestoreSdk.doc(db, "reviews", String(id)));
  }

  root.FlowerReviewStore = { subscribe, submit, getForOrder, subscribeAll, migrateLegacyAdminReviews, update, remove };
})(typeof window !== "undefined" ? window : globalThis);
