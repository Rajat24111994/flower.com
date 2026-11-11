import "./admin-state.js";
import "./admin-data.js?v=1";
import "./admin-lifecycle.js?v=1";
import "./admin-dashboard.js?v=1";
import "./admin-products.js?v=1";
import "./admin-categories.js?v=1";
import "./admin-promotions.js?v=1";
import "./admin-delivery.js?v=1";
import "./admin-orders.js?v=1";
import "./admin-reviews.js?v=1";
import "./admin-users.js?v=1";
import "./admin-events.js?v=1";
import { firebaseConfig } from "../core/firebase-config.js";
async function initializeAdmin() {
   try {
       const [appSdk, authSdk] = await Promise.all([
           import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
           import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
       ]);
       const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
       const auth = authSdk.getAuth(app);
       currentUser = await new Promise((resolve, reject) => {
           let unsubscribe = () => {};
           unsubscribe = authSdk.onAuthStateChanged(auth, (user) => {
               unsubscribe();
               resolve(user);
           }, (error) => {
               unsubscribe();
               reject(error);
           });
       });

       if (!currentUser) {
           window.location.replace("./login.html");
           return;
       }

       const token = await currentUser.getIdTokenResult();
       if (token.claims.admin !== true) {
           await authSdk.signOut(auth);
           window.FlowerSafeStorage.remove("loggedUser");
           window.FlowerSafeStorage.remove("loggedAdmin");
           window.location.replace("./login.html");
           return;
       }

       currentUserRole = token.claims.role === "owner" ? "owner" : "admin";
       const storedAccount = window.FlowerSafeStorage.readJson("loggedUser", {
           fallback: {},
           validate: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
       });
       window.FlowerSafeStorage.writeJson("loggedUser", {
           ...storedAccount,
           uid: currentUser.uid,
           email: currentUser.email || "",
           role: currentUserRole
       });

       // Buttons must work even while (or if) the data below is still loading.
       bindAdminEvents({ auth, signOut: authSdk.signOut });
       try {
           await withTimeout(ensureStorage(), "Tải sản phẩm");
       } catch (error) {
           console.error("Không thể tải kho sản phẩm:", error);
       }
       try {
           await withTimeout(window.FlowerOrderStore.expireReservations(), "Dọn đơn hết hạn");
       } catch (error) {
           console.error("Không thể giải phóng tồn kho đơn đã hết hạn:", error);
       }
       try {
           const promotions = await withTimeout(window.FlowerOrderStore.initializePromotions(getOffers()), "Tải ưu đãi");
           cacheOffers(promotions);
           stopPromotionSubscription = await window.FlowerOrderStore.subscribePromotions((latest) => {
               cacheOffers(latest);
               // Refresh the open offers tab, unless the admin is part-way through the add form.
               const form = main.querySelector("#add-offer-form");
               const typing = form && (form.querySelector("#offer-name")?.value || form.querySelector("#offer-percent")?.value
                   || form.querySelector('input[name="productIds"]:checked'));
               if (form && !typing) renderOffersTab();
           }, (error) => console.error("Không thể đồng bộ ưu đãi từ Firestore:", error));
       } catch (error) {
           console.error("Không thể đồng bộ ưu đãi dùng chung:", error);
       }
       try {
           stopOrderSubscription = await window.FlowerOrderStore.subscribeAdmin((orders) => {
               ordersCache = orders;
               orderStoreError = null;
               refreshOrdersView();
           }, (error) => {
               console.error("Không thể đồng bộ đơn hàng từ Firestore:", error);
               orderStoreError = error;
               refreshOrdersView();
           });
       } catch (error) {
           console.error("Không thể kết nối kho đơn hàng Firestore:", error);
           orderStoreError = error;
       }
       try {
           await withTimeout(loadCategories(), "Tải phân loại");
           stopCategorySubscription = FlowerInventory.subscribeCategories((categories) => {
               cacheCategories(categories);
               if (main.querySelector(".panel h2")?.textContent === "Quản lý phân loại") renderCategoriesTab();
           }, (error) => console.error("Không thể đồng bộ phân loại từ Firestore:", error));
       } catch (error) {
           console.error("Không thể tải phân loại từ Firestore:", error);
           try {
               categoriesCache = readLegacyCategories();
           } catch (storageError) {
               console.error("Không đọc được cache danh mục; giữ nguyên dữ liệu gốc:", storageError);
           }
       }
       try {
           const messageMigrationKey = "flowerMessagesMigratedV1";
           const legacyMessages = window.FlowerSafeStorage.readJson("flowerMessages", {
               fallback: [],
               validate: (value) => Array.isArray(value)
                   && value.every((message) => message && typeof message === "object" && !Array.isArray(message)),
               throwOnError: true
           });
           await withTimeout(window.FlowerMessageStore.migrateLegacyMessages(legacyMessages), "Chuyển phản hồi cũ");
           window.FlowerSafeStorage.remove("flowerMessages", { required: true });
           window.FlowerSafeStorage.writeText(messageMigrationKey, "true", { required: true });
       } catch (error) {
           console.error("Không thể chuyển phản hồi cũ lên Firestore:", error);
       }
       try {
           const reviewMigrationKey = "flowerReviewsAdminMigratedV1";
           if (window.FlowerSafeStorage.readText(reviewMigrationKey) !== "true") {
               const legacyReviews = window.FlowerSafeStorage.readJson("flowerReviews", {
                   fallback: [],
                   validate: (value) => Array.isArray(value)
                       && value.every((review) => review && typeof review === "object" && !Array.isArray(review)),
                   throwOnError: true
               });
               await withTimeout(window.FlowerReviewStore.migrateLegacyAdminReviews(legacyReviews), "Chuyển đánh giá cũ");
               window.FlowerSafeStorage.writeText(reviewMigrationKey, "true", { required: true });
           }
       } catch (error) {
           console.error("Không thể chuyển đánh giá quản trị cũ lên Firestore:", error);
       }
       stopReviewSubscription = window.FlowerReviewStore.subscribeAll((reviews) => {
           reviewsCache = reviews;
           const heading = main.querySelector(".panel h2")?.textContent;
           if (heading === "Đánh giá khách hàng") rerenderKeepingEdits(renderReviewsTab);
           else if (main.querySelector(".dashboard")) renderDashboard();
       }, (error) => console.error("Không thể đồng bộ đánh giá từ Firestore:", error));
       try {
           stopMessageSubscription = await withTimeout(window.FlowerMessageStore.subscribeAdmin((messages) => {
               messagesCache = messages;
               if (main.querySelector(".panel h2")?.textContent === "Phản hồi từ khách hàng") rerenderKeepingEdits(renderMessagesTab);
               else if (main.querySelector(".dashboard")) renderDashboard();
           }, (error) => console.error("Không thể đồng bộ phản hồi từ Firestore:", error)), "Tải phản hồi");
       } catch (error) {
           console.error("Không thể kết nối phản hồi Firestore:", error);
       }
       renderDashboard();
   } catch (error) {
       console.error("Không thể xác thực trang quản trị:", error);
       main.textContent = "Không thể xác thực quyền quản trị. Kiểm tra cấu hình Firebase rồi tải lại trang.";
   }
}

initializeAdmin();
