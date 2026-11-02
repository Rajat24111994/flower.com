(function initializeFlowerMessageStore(root) {
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
        return { auth: authSdk.getAuth(app), db: firestoreSdk.getFirestore(app), firestoreSdk };
      })().catch((error) => {
        firebasePromise = null;
        throw error;
      });
    }
    return firebasePromise;
  }

  async function requireAdmin() {
    const firebase = await getFirebase();
    await firebase.auth.authStateReady();
    if (!firebase.auth.currentUser
      || (await firebase.auth.currentUser.getIdTokenResult()).claims.admin !== true) {
      throw new Error("Chỉ quản trị viên mới được quản lý phản hồi.");
    }
    return firebase;
  }

  function normalizeLegacyMessage(message) {
    const timestamp = new Date(message?.createdAt || 0);
    return {
      customerName: String(message?.customerName || "Khách hàng").slice(0, 100),
      phone: String(message?.phone || "").replace(/\D/g, "").slice(0, 15),
      subject: String(message?.subject || "Tư vấn đơn hàng").slice(0, 120),
      message: String(message?.message || "").slice(0, 3000),
      reply: String(message?.reply || "").slice(0, 3000),
      ...(message?.completedAt ? { completedAt: String(message.completedAt) } : {}),
      createdAt: timestamp.toString() === "Invalid Date" ? new Date() : timestamp
    };
  }

  async function migrateLegacyMessages(messages = []) {
    const { db, firestoreSdk } = await requireAdmin();
    const items = (Array.isArray(messages) ? messages : []).filter((message) => (
      message && !["3001", "3002"].includes(String(message.id)) && String(message.message || "").trim()
    ));
    for (const message of items) {
      const safeId = String(message.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      const reference = safeId
        ? firestoreSdk.doc(db, "messages", `legacy-${safeId}`)
        : firestoreSdk.doc(firestoreSdk.collection(db, "messages"));
      const existing = await firestoreSdk.getDoc(reference);
      if (!existing.exists()) {
        await firestoreSdk.setDoc(reference, {
          ...normalizeLegacyMessage(message),
          source: "legacy-local"
        });
      }
    }
    return items.length;
  }

  async function subscribeAdmin(onMessages, onError = () => {}) {
    const { db, firestoreSdk } = await requireAdmin();
    const messagesQuery = firestoreSdk.query(
      firestoreSdk.collection(db, "messages"),
      firestoreSdk.orderBy("createdAt", "desc")
    );
    return firestoreSdk.onSnapshot(messagesQuery, (snapshot) => {
      onMessages(snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          ...data,
          createdAt: data.createdAt?.toDate?.().toISOString() || data.createdAt || "",
          source: "legacy"
        };
      }));
    }, onError);
  }

  async function updateAdminMessage(id, changes) {
    const { db, firestoreSdk } = await requireAdmin();
    const allowedChanges = {};
    if (Object.prototype.hasOwnProperty.call(changes || {}, "reply")) {
      allowedChanges.reply = String(changes.reply || "").slice(0, 3000);
    }
    if (Object.prototype.hasOwnProperty.call(changes || {}, "completedAt")) {
      allowedChanges.completedAt = changes.completedAt || null;
    }
    if (!Object.keys(allowedChanges).length) return;
    await firestoreSdk.updateDoc(firestoreSdk.doc(db, "messages", String(id)), allowedChanges);
  }

  async function deleteAdminMessage(id) {
    const { db, firestoreSdk } = await requireAdmin();
    await firestoreSdk.deleteDoc(firestoreSdk.doc(db, "messages", String(id)));
  }

  root.FlowerMessageStore = { migrateLegacyMessages, subscribeAdmin, updateAdminMessage, deleteAdminMessage };
})(typeof window !== "undefined" ? window : globalThis);
