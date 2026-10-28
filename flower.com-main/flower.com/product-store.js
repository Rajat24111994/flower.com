(() => {
    const PRODUCT_KEY = "flowerInventory";
    const CATEGORY_KEY = "flowerCategories";
    const LEGACY_USD_TO_VND = 25949.123093;
    let initialization;
    let synchronization;
    let firebaseApiPromise;
    let unsubscribeProducts;
    let unsubscribeCategories;
    let catalogProducts = [];
    let firestoreReachable = null;
    let productsLoaded = false;

    function storage() {
        try {
            return window.localStorage;
        } catch (error) {
            return null;
        }
    }

    // Prices are whole VND. Products saved before v0.2 still hold a USD price (e.g. 73.99) until
    // `npm run setup-firestore` migrates them; read those the same way the migration converts them.
    function toVndPrice(value) {
        const price = Number(value);
        if (!Number.isFinite(price) || price < 0) return 0;
        return price > 0 && price < 1000
            ? Math.round((price * LEGACY_USD_TO_VND) / 1000) * 1000
            : Math.round(price);
    }

    function normalizeProduct(product = {}) {
        const rawId = product.id ?? product._id;
        const numericId = Number(rawId);
        const price = toVndPrice(product.price ?? 0);
        const title = String(product.title ?? "Sản phẩm").trim();
        const description = String(product.description ?? "").trim();
        return {
            id: Number.isFinite(numericId) && numericId > 0 ? numericId : String(rawId ?? Date.now()),
            title,
            price,
            quantity: Number(product.quantity ?? product.stock ?? 10),
            image: product.image || "",
            images: Array.isArray(product.images) ? product.images.filter((image) => typeof image === "string" && image) : [],
            category: String(product.category || "").trim(),
            categoryKey: String(product.categoryKey || "").trim(),
            sameDayDelivery: product.sameDayDelivery === true,
            onSale: product.onSale === true,
            description
        };
    }

    function deduplicateProducts(products) {
        const uniqueProducts = new Map();
        // Products are identified by id only: different products may share an image or a title.
        (Array.isArray(products) ? products : []).map(normalizeProduct).forEach((product) => {
            const identity = String(product.id);
            if (!uniqueProducts.has(identity)) uniqueProducts.set(identity, product);
        });
        return Array.from(uniqueProducts.values());
    }

    function mergeCatalogProducts(existing = [], catalog = []) {
        const catalogById = new Map((Array.isArray(catalog) ? catalog : []).map((item) => {
            const product = normalizeProduct(item);
            return [String(product.id), product];
        }));
        const merged = new Map((Array.isArray(existing) ? existing : []).map((item) => {
            const product = normalizeProduct(item);
            const catalogProduct = catalogById.get(String(product.id));
            if (product.title.includes("?") && catalogProduct && !catalogProduct.title.includes("?")) {
                product.title = catalogProduct.title;
            }
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
            if (typeof window !== "undefined" && window.FlowerSafeStorage?.readJson) {
                return deduplicateProducts(window.FlowerSafeStorage.readJson(PRODUCT_KEY, {
                    fallback: [],
                    validate: (value) => Array.isArray(value)
                        && value.every((product) => product
                            && typeof product === "object"
                            && !Array.isArray(product)
                            && (product.id !== undefined || product._id !== undefined)
                            && typeof product.title === "string"
                            && Number.isFinite(Number(product.price))),
                    throwOnError: true
                }));
            }
            return deduplicateProducts(JSON.parse(storage()?.getItem(PRODUCT_KEY) || "[]"));
        } catch (error) {
            console.warn("Không đọc được kho sản phẩm:", error);
            return [];
        }
    }

    function cacheProducts(products, notify = true) {
        const normalized = deduplicateProducts(products);
        if (typeof window !== "undefined" && window.FlowerSafeStorage?.writeJson) {
            window.FlowerSafeStorage.writeJson(PRODUCT_KEY, normalized);
        } else {
            storage()?.setItem(PRODUCT_KEY, JSON.stringify(normalized));
        }
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
                const auth = authSdk.getAuth(app);
                const db = firestoreSdk.getFirestore(app);
                configModule.connectFirebaseEmulators(app, auth, db, authSdk, firestoreSdk);
                return {
                    app,
                    auth,
                    db,
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

    // Products from the server-side API (works when the browser cannot reach Firestore).
    async function readProductsFromApi() {
        try {
            const response = await fetch("/api/products", { headers: { Accept: "application/json" }, cache: "no-store" });
            if (!response.ok) return null;
            const result = await response.json();
            return Array.isArray(result.products) ? result.products.map((product) => normalizeProduct(product)) : null;
        } catch (error) {
            console.warn("Không đọc được sản phẩm qua máy chủ:", error);
            return null;
        }
    }

    async function readRemoteProducts() {
        const firebase = await getFirebaseApi();
        if (firebase) {
            try {
                const { db, firestoreSdk } = firebase;
                // getDocsFromServer fails when the browser cannot reach Firestore instead of quietly
                // returning an empty local cache (which looked like "every product is gone").
                const snapshot = await firestoreSdk.getDocsFromServer(firestoreSdk.collection(db, "products"));
                firestoreReachable = true;
                return snapshot.docs.map((doc) => normalizeProduct({ ...doc.data(), id: doc.id }));
            } catch (error) {
                console.warn("Không đọc được sản phẩm trên Firestore:", error);
            }
        }
        firestoreReachable = false;
        return readProductsFromApi();
    }

    function normalizeCategories(categories) {
        return [...new Set((Array.isArray(categories) ? categories : [])
            .map((category) => String(category || "").trim())
            .filter(Boolean))].sort((left, right) => left.localeCompare(right, "vi"));
    }

    function cacheCategories(categories, notify = true) {
        const normalized = normalizeCategories(categories);
        if (typeof window !== "undefined" && window.FlowerSafeStorage?.writeJson) {
            window.FlowerSafeStorage.writeJson(CATEGORY_KEY, normalized);
        } else {
            storage()?.setItem(CATEGORY_KEY, JSON.stringify(normalized));
        }
        if (notify && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("flowercategorieschange", { detail: normalized }));
        }
        return normalized;
    }

    function readCategories() {
        try {
            if (typeof window !== "undefined" && window.FlowerSafeStorage?.readJson) {
                return normalizeCategories(window.FlowerSafeStorage.readJson(CATEGORY_KEY, {
                    fallback: [],
                    validate: (value) => Array.isArray(value)
                        && value.every((category) => typeof category === "string"),
                    throwOnError: true
                }));
            }
            const categories = JSON.parse(storage()?.getItem(CATEGORY_KEY) || "[]");
            return normalizeCategories(categories);
        } catch (error) {
            console.warn("Không đọc được cache danh mục:", error);
            return [];
        }
    }

    async function getCategories() {
        const firebase = await getFirebaseApi();
        if (!firebase) return readCategories();
        const reference = firebase.firestoreSdk.doc(firebase.db, "metadata", "storeCategories");
        const snapshot = await firebase.firestoreSdk.getDoc(reference);
        const categories = snapshot.exists() ? snapshot.data().items : [];
        return cacheCategories(categories, false);
    }

    async function initializeCategories(legacyCategories = []) {
        const firebase = await getFirebaseApi();
        if (!firebase) throw new Error("Không kết nối được Firestore để tải danh mục dùng chung.");
        await firebase.auth.authStateReady();
        const isAdmin = Boolean(firebase.auth.currentUser
            && (await firebase.auth.currentUser.getIdTokenResult()).claims.admin === true);
        const reference = firebase.firestoreSdk.doc(firebase.db, "metadata", "storeCategories");
        if (!isAdmin) return getCategories();
        const categories = await firebase.firestoreSdk.runTransaction(firebase.db, async (transaction) => {
            const snapshot = await transaction.get(reference);
            if (snapshot.exists()) return snapshot.data().items;
            const initialCategories = normalizeCategories(legacyCategories);
            transaction.set(reference, {
                items: initialCategories,
                updatedAt: firebase.firestoreSdk.serverTimestamp()
            });
            return initialCategories;
        });
        return cacheCategories(categories);
    }

    async function saveCategories(categories) {
        const firebase = await getFirebaseApi();
        if (!firebase) throw new Error("Không kết nối được Firestore để lưu danh mục dùng chung.");
        await firebase.auth.authStateReady();
        if (!firebase.auth.currentUser
            || (await firebase.auth.currentUser.getIdTokenResult()).claims.admin !== true) {
            throw new Error("Chỉ quản trị viên mới được thay đổi danh mục.");
        }
        const normalized = normalizeCategories(categories);
        await firebase.firestoreSdk.setDoc(
            firebase.firestoreSdk.doc(firebase.db, "metadata", "storeCategories"),
            { items: normalized, updatedAt: firebase.firestoreSdk.serverTimestamp() }
        );
        return cacheCategories(normalized);
    }

    function subscribeCategories(onCategories, onError = () => {}) {
        if (unsubscribeCategories) unsubscribeCategories();
        let active = true;
        getFirebaseApi().then((firebase) => {
            if (!active || !firebase) return;
            unsubscribeCategories = firebase.firestoreSdk.onSnapshot(
                firebase.firestoreSdk.doc(firebase.db, "metadata", "storeCategories"),
                (snapshot) => {
                    const categories = cacheCategories(snapshot.exists() ? snapshot.data().items : []);
                    onCategories(categories);
                },
                onError
            );
        }).catch(onError);
        return () => {
            active = false;
            if (unsubscribeCategories) unsubscribeCategories();
            unsubscribeCategories = null;
        };
    }

    // Writes only the fields the admin actually changed (compared with the copy they were
    // looking at), so saving one product never overwrites stock that orders changed meanwhile.
    async function writeRemoteProducts(products, previousProducts) {
        const firebase = await getFirebaseApi();
        if (!firebase) return false;
        try {
            const { db, firestoreSdk } = firebase;
            const previousById = new Map(previousProducts.map((product) => [String(product.id), normalizeProduct(product)]));
            const keptIds = new Set();
            const batch = firestoreSdk.writeBatch(db);
            let writes = 0;
            products.map(normalizeProduct).forEach((product) => {
                const id = String(product.id);
                keptIds.add(id);
                const reference = firestoreSdk.doc(db, "products", id);
                const previous = previousById.get(id);
                if (!previous) {
                    batch.set(reference, product);
                    writes += 1;
                    return;
                }
                const changedFields = Object.fromEntries(Object.entries(product)
                    .filter(([key, value]) => key !== "id" && JSON.stringify(value) !== JSON.stringify(previous[key])));
                if (!Object.keys(changedFields).length) return;
                batch.update(reference, changedFields);
                writes += 1;
            });
            previousById.forEach((_product, id) => {
                if (keptIds.has(id)) return;
                batch.delete(firestoreSdk.doc(db, "products", id));
                writes += 1;
            });
            if (writes) await batch.commit();
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

    // Firestore is the source of truth: the cache mirrors it exactly, including deletions.
    function subscribeToProducts() {
        if (unsubscribeProducts) return;
        getFirebaseApi().then((firebase) => {
            if (!firebase || unsubscribeProducts) return;
            const { db, firestoreSdk } = firebase;
            unsubscribeProducts = firestoreSdk.onSnapshot(
                firestoreSdk.collection(db, "products"),
                (snapshot) => {
                    // Snapshots served from the local cache while offline may be empty or stale.
                    if (snapshot.metadata.fromCache) return;
                    cacheProducts(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
                },
                (error) => console.warn("Không nhận được cập nhật sản phẩm:", error)
            );
        });
    }

    async function saveProducts(products) {
        const normalized = deduplicateProducts(products);
        const saved = await writeRemoteProducts(normalized, readProducts());
        if (!saved) {
            throw new Error("Could not synchronize the product catalog with Firestore.");
        }
        return cacheProducts(normalized);
    }

    // Loads products from Firestore. flower.json is only used once, by an admin, to seed an
    // empty catalog; after that, products an admin deleted stay deleted.
    async function synchronizeProducts(catalog) {
        const firebase = await getFirebaseApi();
        const remoteProducts = await readRemoteProducts();
        if (remoteProducts === null) return false;
        productsLoaded = true;
        if (!firestoreReachable) {
            // Read through the server: show the data, keep polling it, skip client-side seeding.
            cacheProducts(remoteProducts);
            scheduleApiRefresh();
            return true;
        }

        let isAdmin = false;
        try {
            const user = firebase.auth.currentUser;
            isAdmin = Boolean(user && (await user.getIdTokenResult()).claims.admin === true);
        } catch (error) {
            console.warn("Không xác minh được quyền khởi tạo catalog:", error);
        }

        let products = remoteProducts;
        if (isAdmin) {
            // Seed only when we know for sure the catalog was never seeded; if the marker cannot be
            // read, do nothing rather than writing (writes made offline never finish).
            let catalogSeeded = null;
            try {
                const marker = await firebase.firestoreSdk.getDocFromServer(
                    firebase.firestoreSdk.doc(firebase.db, "metadata", "productCatalog")
                );
                catalogSeeded = marker.exists() && marker.data().catalogSeeded === true;
            } catch (error) {
                console.warn("Không đọc được trạng thái khởi tạo catalog:", error);
            }
            if (catalogSeeded === false) {
                products = mergeCatalogProducts(remoteProducts, catalog);
                await syncMissingRemoteProducts(remoteProducts, products, true);
            }
        }
        cacheProducts(products);
        subscribeToProducts();
        return true;
    }

    let apiRefreshTimer = null;
    function scheduleApiRefresh() {
        if (apiRefreshTimer || typeof window === "undefined") return;
        apiRefreshTimer = window.setInterval(async () => {
            const products = await readProductsFromApi();
            if (products) cacheProducts(products);
        }, 30000);
    }

    function startProductSynchronization(catalog) {
        if (synchronization) return synchronization;
        synchronization = synchronizeProducts(catalog)
            .catch((error) => {
                console.warn("Không thể đồng bộ sản phẩm:", error);
                return false;
            })
            .finally(() => {
                synchronization = null;
            });
        return synchronization;
    }

    async function initialize() {
        if (initialization) return initialization;
        initialization = (async () => {
            const localProducts = readProducts();
            let catalog = [];
            try {
                const response = await fetch("./flower.json?v=2");
                if (response.ok) {
                    const data = await response.json();
                    // Starting stock, used only when an admin seeds an empty catalog.
                    catalog = Array.isArray(data.flower) ? data.flower.map((item) => ({ ...item, quantity: item.quantity ?? 10 })) : [];
                    catalogProducts = catalog;
                }
            } catch (error) {
                console.warn("Không tải được catalog sản phẩm:", error);
            }

            if (localProducts.length) {
                startProductSynchronization(catalog);
                return localProducts;
            }
            if (await startProductSynchronization(catalog)) return readProducts();
            // Firestore unreachable on a first visit: show the catalog but nothing as in stock.
            return deduplicateProducts(catalog.map((item) => ({ ...item, quantity: 0 })));
        })().finally(() => {
            initialization = null;
        });
        return initialization;
    }

    // Products of flower.json that are not in the shop any more (lost or deleted).
    function getMissingCatalogProducts() {
        if (!productsLoaded) return [];
        const shopIds = new Set(readProducts().map((product) => String(product.id)));
        return catalogProducts.filter((product) => !shopIds.has(String(normalizeProduct(product).id)));
    }

    // Admin only: adds back the flower.json products that are missing from Firestore, with their
    // starting stock, through the server (so it also works when Firestore is blocked here).
    async function restoreCatalogProducts() {
        const firebase = await getFirebaseApi();
        if (!firebase) throw new Error("Không tải được Firebase.");
        await firebase.auth.authStateReady();
        const user = firebase.auth.currentUser;
        if (!user) throw new Error("Vui lòng đăng nhập tài khoản quản trị.");
        const response = await fetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
            body: JSON.stringify({ action: "restore-catalog" })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Chưa thể khôi phục sản phẩm.");
        const products = await readRemoteProducts();
        if (products) cacheProducts(products);
        return result.restored || 0;
    }

    const api = {
        initialize,
        getMissingCatalogProducts,
        isFirestoreReachable: () => firestoreReachable,
        areProductsLoaded: () => productsLoaded,
        restoreCatalogProducts,
        readProducts,
        saveProducts,
        mergeCatalogProducts,
        normalizeProduct,
        toVndPrice,
        getCategories,
        readCategories,
        initializeCategories,
        saveCategories,
        subscribeCategories
    };
    if (typeof window !== "undefined") window.FlowerInventory = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
