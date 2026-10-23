(() => {
    const PRODUCT_KEY = "flowerInventory";
    let initialization;
    let synchronization;
    let firebaseApiPromise;
    let unsubscribeProducts;

    function storage() {
        try {
            return window.localStorage;
        } catch (error) {
            return null;
        }
    }

    function normalizeProduct(product = {}) {
        const rawId = product.id ?? product._id;
        const numericId = Number(rawId);
        const rawPrice = Number(product.price ?? 0);
        const price = rawPrice > 10000
            ? (typeof usdFromVnd === "function" ? usdFromVnd(rawPrice) : rawPrice / 25949.123093)
            : rawPrice;
        return {
            id: Number.isFinite(numericId) && numericId > 0 ? numericId : String(rawId ?? Date.now()),
            title: String(product.title ?? "Sản phẩm").trim(),
            price,
            quantity: Number(product.quantity ?? product.stock ?? 10),
            image: product.image || "",
            images: Array.isArray(product.images) ? product.images.filter((image) => typeof image === "string" && image) : [],
            category: String(product.category || "").trim(),
            categoryKey: String(product.categoryKey || "").trim(),
            sameDayDelivery: product.sameDayDelivery === true,
            onSale: product.onSale === true,
            description: product.description || ""
        };
    }

    function deduplicateProducts(products) {
        const uniqueProducts = new Map();
        (Array.isArray(products) ? products : []).map(normalizeProduct).forEach((product) => {
            const title = product.title.toLocaleLowerCase("vi");
            const existing = uniqueProducts.get(title);
            if (!existing || Number(product.id) < Number(existing.id)) {
                uniqueProducts.set(title, product);
            }
        });
        return Array.from(uniqueProducts.values());
    }

    function mergeCatalogProducts(existing = [], catalog = []) {
        const merged = new Map((Array.isArray(existing) ? existing : []).map((item) => {
            const product = normalizeProduct(item);
            return [String(product.id), product];
        }));
        (Array.isArray(catalog) ? catalog : []).forEach((item) => {
            const product = normalizeProduct(item);
            if (!merged.has(String(product.id))) merged.set(String(product.id), product);
        });
        return deduplicateProducts(Array.from(merged.values()));
    }

    function readProducts() {
        try {
            return deduplicateProducts(JSON.parse(storage()?.getItem(PRODUCT_KEY) || "[]"));
        } catch (error) {
            console.warn("Không đọc được kho sản phẩm:", error);
            return [];
        }
    }

    function cacheProducts(products, notify = true) {
        const normalized = deduplicateProducts(products);
        storage()?.setItem(PRODUCT_KEY, JSON.stringify(normalized));
        if (notify) {
            window.dispatchEvent(new CustomEvent("flowerinventorychange", { detail: normalized }));
        }
        return normalized;
    }

    async function getFirebaseApi() {
        if (!firebaseApiPromise) {
            firebaseApiPromise = (async () => {
                const configModule = await import("./firebase-config.js");
                const [appSdk, authSdk, firestoreSdk] = await Promise.all([
                    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
                    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js"),
                    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
                ]);
                const app = appSdk.getApps().length
                    ? appSdk.getApp()
                    : appSdk.initializeApp(configModule.firebaseConfig);
                return {
                    app,
                    auth: authSdk.getAuth(app),
                    db: firestoreSdk.getFirestore(app),
                    firestoreSdk
                };
            })().catch((error) => {
                firebaseApiPromise = null;
                console.warn("Firestore chưa sẵn sàng:", error);
                return null;
            });
        }
        return firebaseApiPromise;
    }

    async function readRemoteProducts() {
        const firebase = await getFirebaseApi();
        if (!firebase) return null;
        try {
            const { db, firestoreSdk } = firebase;
            const snapshot = await firestoreSdk.getDocs(firestoreSdk.collection(db, "products"));
            return snapshot.docs.map((doc) => normalizeProduct({ ...doc.data(), id: doc.id }));
        } catch (error) {
            console.warn("Không đọc được sản phẩm trên Firestore:", error);
            return null;
        }
    }

    async function writeRemoteProducts(products, markCatalogSeeded = false) {
        const firebase = await getFirebaseApi();
        if (!firebase) return false;
        try {
            const { db, firestoreSdk } = firebase;
            const collection = firestoreSdk.collection(db, "products");
            const snapshot = await firestoreSdk.getDocs(collection);
            const batch = firestoreSdk.writeBatch(db);
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            products.map(normalizeProduct).forEach((product) => {
                batch.set(firestoreSdk.doc(db, "products", String(product.id)), product);
            });
            if (markCatalogSeeded) {
                batch.set(firestoreSdk.doc(db, "metadata", "productCatalog"), { catalogSeeded: true });
            }
            await batch.commit();
            return true;
        } catch (error) {
            console.warn("Không ghi được sản phẩm lên Firestore:", error);
            return false;
        }
    }

    async function syncMissingRemoteProducts(remoteProducts, products, markCatalogSeeded = false) {
        const firebase = await getFirebaseApi();
        if (!firebase) return false;
        try {
            const { db, firestoreSdk } = firebase;
            const existingIds = new Set(remoteProducts.map((product) => String(normalizeProduct(product).id)));
            const missingProducts = products.filter((product) => !existingIds.has(String(normalizeProduct(product).id)));
            const snapshot = await firestoreSdk.getDocs(firestoreSdk.collection(db, "products"));
            const productsNeedingPriceMigration = snapshot.docs.filter((doc) => {
                const normalized = normalizeProduct({ ...doc.data(), id: doc.id });
                return Number(doc.data().price) !== normalized.price;
            });
            if (!missingProducts.length && !productsNeedingPriceMigration.length && !markCatalogSeeded) return true;

            const batch = firestoreSdk.writeBatch(db);
            productsNeedingPriceMigration.forEach((doc) => {
                const normalized = normalizeProduct({ ...doc.data(), id: doc.id });
                batch.update(doc.ref, { price: normalized.price });
            });
            missingProducts.forEach((product) => {
                const normalized = normalizeProduct(product);
                batch.set(firestoreSdk.doc(db, "products", String(normalized.id)), normalized);
            });
            if (markCatalogSeeded) {
                batch.set(firestoreSdk.doc(db, "metadata", "productCatalog"), { catalogSeeded: true });
            }
            await batch.commit();
            return true;
        } catch (error) {
            console.warn("Không thể bổ sung sản phẩm còn thiếu trên Firestore:", error);
            return false;
        }
    }

    function subscribeToProducts(catalog) {
        if (unsubscribeProducts) return;
        getFirebaseApi().then((firebase) => {
            if (!firebase || unsubscribeProducts) return;
            const { db, firestoreSdk } = firebase;
            unsubscribeProducts = firestoreSdk.onSnapshot(
                firestoreSdk.collection(db, "products"),
                (snapshot) => {
                    if (snapshot.empty) return;
                    const remoteProducts = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
                    cacheProducts(mergeCatalogProducts(remoteProducts, catalog));
                },
                (error) => console.warn("Không nhận được cập nhật sản phẩm:", error)
            );
        });
    }

    function saveProducts(products) {
        const normalized = cacheProducts(products);
        writeRemoteProducts(normalized);
        return normalized;
    }

    async function synchronizeProducts(localProducts, catalog) {
        const firebase = await getFirebaseApi();
        const remoteProducts = firebase ? await readRemoteProducts() : null;
        if (remoteProducts === null) return;

        let isAdmin = false;
        try {
            const user = firebase.auth.currentUser;
            isAdmin = Boolean(user && (await user.getIdTokenResult()).claims.admin === true);
        } catch (error) {
            console.warn("Không xác minh được quyền khởi tạo catalog:", error);
        }

        let catalogSeeded = false;
        if (isAdmin) {
            try {
                const marker = await firebase.firestoreSdk.getDoc(
                    firebase.firestoreSdk.doc(firebase.db, "metadata", "productCatalog")
                );
                catalogSeeded = marker.exists() && marker.data().catalogSeeded === true;
            } catch (error) {
                console.warn("Không đọc được trạng thái khởi tạo catalog:", error);
            }
        }

        const existingProducts = remoteProducts.length ? remoteProducts : localProducts;
        const products = mergeCatalogProducts(existingProducts, catalog);
        if (isAdmin) {
            await syncMissingRemoteProducts(remoteProducts, products, !catalogSeeded);
        }
        cacheProducts(products);
        subscribeToProducts(catalog);
    }

    function startProductSynchronization(localProducts, catalog) {
        if (synchronization) return;
        synchronization = synchronizeProducts(localProducts, catalog)
            .catch((error) => console.warn("Không thể đồng bộ sản phẩm:", error))
            .finally(() => {
                synchronization = null;
            });
    }

    async function initialize() {
        if (initialization) return initialization;
        initialization = (async () => {
            const localProducts = readProducts();
            let catalog = [];
            try {
                const response = await fetch("./flower.json");
                if (response.ok) {
                    const data = await response.json();
                    catalog = Array.isArray(data.flower) ? data.flower.map((item) => ({ ...item, quantity: 10 })) : [];
                }
            } catch (error) {
                console.warn("Không tải được catalog sản phẩm:", error);
            }

            const products = mergeCatalogProducts(localProducts, catalog);
            cacheProducts(products, false);
            startProductSynchronization(localProducts, catalog);
            return products;
        })().finally(() => {
            initialization = null;
        });
        return initialization;
    }

    const api = { initialize, readProducts, saveProducts, mergeCatalogProducts, normalizeProduct };
    if (typeof window !== "undefined") window.FlowerInventory = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
