import { firebaseConfig } from "./firebase-config.js";
import { ORDER_STATUSES, normalizeOrderStatus } from "./order-status.js";

let productPage = document.getElementById("product_page");
let categoriesPage = document.getElementById("categories_page");
let offersPage = document.getElementById("offers_page");
let ordersPage = document.getElementById("orders_page");
let reviewsPage = document.getElementById("reviews_page");
let messagesPage = document.getElementById("messages_page");
let revenuePage = document.getElementById("revenue_page");
let usersPage = document.getElementById("users_page");
let logOutPage = document.getElementById("logout_page");
let main = document.querySelector("main");
let currentUser;
let currentUserRole = "admin";
let editingProductId = null;
let productSearchTerm = "";
let ordersCache = [];
let orderStoreError = null;
let stopOrderSubscription = null;
let stopPromotionSubscription = null;
let reviewsCache = [];
let stopReviewSubscription = null;
let categoriesCache = [];
let stopCategorySubscription = null;
let messagesCache = [];
let stopMessageSubscription = null;
let revenueDateFilter = "month";
const initialRevenueDate = new Date();
let revenueMonth = `${initialRevenueDate.getFullYear()}-${String(initialRevenueDate.getMonth() + 1).padStart(2, "0")}`;
let revenueDateStart = "";
let revenueDateEnd = "";

const STORAGE_KEYS = {
   categories: "flowerCategories",
   offers: "flowerPromotions"
};

function moneyFormat(value) {
   return new Intl.NumberFormat("vi-VN", {
       style: "currency",
       currency: "VND"
   }).format(Number(value || 0));
}

function isOrderPaid(order) {
   // QR transfers count only after an admin checked the bank statement and
   // confirmed it with "Xác nhận đã nhận tiền" (Security Rules: admin-only write).
   if (order.paymentMethod === "qr") return order.paymentVerified === true;
   const status = String(order.paymentStatus || "").trim().toLocaleLowerCase("vi");
   return ["đã thanh toán", "paid"].includes(status);
}

function getPaymentDisplayStatus(order) {
   if (order.paymentMethod === "qr") {
       if (order.paymentVerified === true) return "Đã thanh toán (đã đối soát)";
       return order.paymentStatus === "Hết hạn chờ thanh toán" ? order.paymentStatus : "Chờ cửa hàng xác minh";
   }
   return order.paymentStatus || (order.paymentMethod === "cod" ? "Thanh toán khi nhận hàng" : "Chưa xác nhận");
}

function isOrderDelivered(order) {
   return normalizeOrderStatus(order.status) === "Đã giao";
}

function getRevenueOrders(orders) {
   return orders.filter((order) => isOrderDelivered(order) && isOrderPaid(order));
}

function localDateKey(value) {
   const date = new Date(value);
   if (Number.isNaN(date.getTime())) return "";
   const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
   return localDate.toISOString().slice(0, 10);
}

function getSelectedRevenueOrders(orders) {
   const paidOrders = getRevenueOrders(orders);
   const now = new Date();
   const today = localDateKey(now);

   return paidOrders.filter((order) => {
       const dateKey = localDateKey(order.paidAt || order.deliveredAt || order.createdAt);
       if (!dateKey) return false;
       if (revenueDateFilter === "today") return dateKey === today;
       if (revenueDateFilter === "month") return dateKey.slice(0, 7) === revenueMonth;
       if (revenueDateFilter === "custom") {
           return (!revenueDateStart || dateKey >= revenueDateStart)
               && (!revenueDateEnd || dateKey <= revenueDateEnd);
       }
       return true;
   });
}

async function ensureStorage() {
   await FlowerInventory.initialize();
}

function readLegacyCategories() {
   return window.FlowerSafeStorage.readJson(STORAGE_KEYS.categories, {
       fallback: [],
       validate: (value) => Array.isArray(value) && value.every((category) => typeof category === "string"),
       throwOnError: true
   });
}

function cacheCategories(categories) {
   categoriesCache = categories;
   try {
       window.FlowerSafeStorage.writeJson(STORAGE_KEYS.categories, categories);
   } catch (error) {
       console.warn("Không lưu được bản sao phân loại trên thiết bị:", error);
   }
}

// Loads categories from Firestore; on first run, uploads the ones this browser had saved locally.
async function loadCategories() {
   const categories = await FlowerInventory.initializeCategories(readLegacyCategories());
   cacheCategories(categories);
   return categories;
}

function getProducts() {
    return FlowerInventory.readProducts();
}

function getCategories() {
   const storedCategories = categoriesCache;
   const productCategories = getProducts().map((product) => product.category);
   return [...new Set(
       [...(Array.isArray(storedCategories) ? storedCategories : []), ...productCategories]
           .map((category) => String(category || "").trim())
           .filter(Boolean)
   )].sort((left, right) => left.localeCompare(right, "vi"));
}

function saveCategories(categories) {
   const normalizedCategories = [...new Set(
       categories.map((category) => String(category || "").trim()).filter(Boolean)
   )];
   const previousCategories = categoriesCache;
   cacheCategories(normalizedCategories);
   window.FlowerOrderStore.saveCategories(normalizedCategories).catch((error) => {
       console.error("Không thể lưu phân loại lên Firestore:", error);
       cacheCategories(previousCategories);
       alert("Chưa thể lưu phân loại lên hệ thống. Hãy thử lại sau.");
       if (main.querySelector(".panel h2")?.textContent === "Quản lý phân loại") renderCategoriesTab();
   });
}

function getOffers() {
   return window.FlowerSafeStorage.readJson(STORAGE_KEYS.offers, {
       fallback: [],
       validate: (value) => Array.isArray(value)
           && value.every((offer) => offer && typeof offer === "object" && !Array.isArray(offer))
   });
}

function cacheOffers(offers) {
   window.FlowerSafeStorage.writeJson(STORAGE_KEYS.offers, offers);
}

// change(latestOffers) runs against the newest server copy, not this browser's cache.
async function updateOffers(change) {
   cacheOffers(await window.FlowerOrderStore.updatePromotions(change));
}

function getOrders() {
   return [...ordersCache];
}

function getReviews() {
   return [...reviewsCache];
}

// Customer messages are the notes left on orders at checkout.
function getMessages() {
   const orderMessages = ordersCache
       .filter((order) => String(order.orderNote || "").trim() && !order.orderNoteArchivedAt)
       .map((order) => ({
           id: String(order.id),
           source: "order",
           customerName: order.customerName,
           phone: order.phone,
           subject: `Lời nhắn kèm đơn #${order.id}`,
           message: order.orderNote,
           createdAt: order.createdAt,
           reply: order.orderNoteReply || "",
           completedAt: order.orderNoteCompletedAt || ""
       }));
   return [...orderMessages, ...messagesCache].sort(
       (first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0)
   );
}

function renderDashboard() {
   // Without order data the dashboard still shows products and the catalog restore button.
   const ordersNotice = orderStoreError
       ? `<div class="restore-catalog-notice" role="alert"><p><strong>Chưa tải được đơn hàng, đánh giá và phản hồi.</strong> Database có thể chưa có luật bảo vệ (firestore.rules): chạy <code>npm run setup-firestore</code> trong thư mục flower.com rồi tải lại trang.</p></div>`
       : "";
   const products = getProducts();
   const orders = getOrders();
   const reviews = getReviews();
   const messages = getMessages();
   const totalStock = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
   const placedOrderValue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
   const totalRevenue = getRevenueOrders(orders).reduce((sum, order) => sum + Number(order.total || 0), 0);

   main.innerHTML = `
       <section class="dashboard">
           ${ordersNotice}
           ${renderRestoreCatalogNotice()}
           <div class="summary">
               <div class="summary-card">
                   <h3>Tổng sản phẩm</h3>
                   <div class="value">${products.length}</div>
               </div>
               <div class="summary-card">
                   <h3>Tổng số lượng hoa</h3>
                   <div class="value">${totalStock}</div>
               </div>
               <div class="summary-card">
                   <h3>Đánh giá</h3>
                   <div class="value">${reviews.length}</div>
               </div>
               <div class="summary-card">
                   <h3>Đơn hàng</h3>
                   <div class="value">${orders.length}</div>
               </div>
               <div class="summary-card">
                   <h3>Phản hồi khách</h3>
                   <div class="value">${messages.length}</div>
               </div>
               <div class="summary-card">
                   <h3>Doanh thu thực nhận</h3>
                   <div class="value">${moneyFormat(totalRevenue)}</div>
                   <small>Toàn thời gian · đơn đã giao và thanh toán</small>
               </div>
               <div class="summary-card">
                   <h3>Giá trị đơn đặt</h3>
                   <div class="value">${moneyFormat(placedOrderValue)}</div>
                   <small>Tất cả đơn, gồm cả đơn chưa hoàn tất</small>
               </div>
           </div>
       </section>
   `;
}

function renderRevenueTab() {
   if (orderStoreError) {
       main.innerHTML = `<section class="panel"><h2>Doanh thu</h2><p class="empty-state">Không thể tải số liệu từ Firestore. Kiểm tra cấu hình và kết nối rồi tải lại trang.</p></section>`;
       return;
   }
   const products = getProducts();
   const orders = getOrders();
   const revenueOrders = getSelectedRevenueOrders(orders);
   const deliveredOrders = orders.filter(isOrderDelivered);
   const totalCurrentStock = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
   const totalSoldUnits = revenueOrders.reduce((sum, order) => {
       const sold = (order.items || []).reduce((orderSum, item) => orderSum + Number(item.quantity || 0), 0);
       return sum + sold;
   }, 0);
   const totalDeliveredUnits = deliveredOrders.reduce((sum, order) => {
       const delivered = (order.items || []).reduce((orderSum, item) => orderSum + Number(item.quantity || 0), 0);
       return sum + delivered;
   }, 0);
   const totalRevenue = revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
   const placedOrderValue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
   const avgRevenuePerOrder = revenueOrders.length ? totalRevenue / revenueOrders.length : 0;
   const hoaDaThem = totalCurrentStock + totalDeliveredUnits;
   const stockHealth = Math.round((totalCurrentStock / Math.max(hoaDaThem, 1)) * 100);

   main.innerHTML = `
       <section class="panel">
           <h2>Doanh thu & kho hàng</h2>
           <form class="revenue-filters" id="revenue-filter-form">
               <label for="revenue-period">Khoảng thời gian</label>
               <select id="revenue-period" name="period">
                   <option value="today" ${revenueDateFilter === "today" ? "selected" : ""}>Hôm nay</option>
                   <option value="month" ${revenueDateFilter === "month" ? "selected" : ""}>Theo tháng</option>
                   <option value="all" ${revenueDateFilter === "all" ? "selected" : ""}>Toàn thời gian</option>
                   <option value="custom" ${revenueDateFilter === "custom" ? "selected" : ""}>Tùy chọn ngày</option>
               </select>
               <div class="revenue-month-picker" id="revenue-month-picker" ${revenueDateFilter !== "month" ? "hidden" : ""}>
                   <button class="secondary-btn" type="button" data-month-shift="-1" aria-label="Xem tháng trước">‹ Tháng trước</button>
                   <label for="revenue-month">Tháng báo cáo</label>
                   <input id="revenue-month" type="month" value="${escapeHtml(revenueMonth)}">
                   <button class="secondary-btn" type="button" data-month-shift="1" aria-label="Xem tháng sau">Tháng sau ›</button>
                   <button class="secondary-btn" type="button" id="revenue-current-month">Tháng hiện tại</button>
               </div>
               <div class="revenue-custom-dates" id="revenue-custom-dates" ${revenueDateFilter !== "custom" ? "hidden" : ""}>
                   <label for="revenue-date-start">Từ ngày</label>
                   <input id="revenue-date-start" name="start" type="date" value="${escapeHtml(revenueDateStart)}">
                   <label for="revenue-date-end">Đến ngày</label>
                   <input id="revenue-date-end" name="end" type="date" value="${escapeHtml(revenueDateEnd)}">
                   <button class="primary-btn" type="submit">Áp dụng</button>
               </div>
           </form>
           <div class="summary revenue-summary">
               <div class="summary-card revenue-card">
                   <h3>Số hoa đã thêm</h3>
                   <div class="value">${hoaDaThem}</div>
                   <small>Tổng lượng hoa nhập/đưa vào kho</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Số hoa đã bán</h3>
                   <div class="value">${totalSoldUnits}</div>
                   <small>Số lượng trong đơn đã giao và thanh toán trong khoảng đã chọn</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Doanh thu thực nhận</h3>
                   <div class="value">${moneyFormat(totalRevenue)}</div>
                   <small>${revenueOrders.length} đơn đã giao và thanh toán trong khoảng đã chọn</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Doanh thu / đơn</h3>
                   <div class="value">${moneyFormat(avgRevenuePerOrder)}</div>
                   <small>Trung bình trên đơn đã giao và thanh toán</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Giá trị đơn đặt</h3>
                   <div class="value">${moneyFormat(placedOrderValue)}</div>
                   <small>Tất cả đơn hàng, không lọc trạng thái</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Hoa hiện có</h3>
                   <div class="value">${totalCurrentStock}</div>
                   <small>Tồn kho hiện tại</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Chỉ số kho</h3>
                   <div class="value">${stockHealth}%</div>
                   <small>Mức độ hàng tồn kho ổn định</small>
               </div>
           </div>
       </section>
   `;

   const periodSelect = document.getElementById("revenue-period");
   const monthPicker = document.getElementById("revenue-month-picker");
   const customDates = document.getElementById("revenue-custom-dates");
   periodSelect.addEventListener("change", () => {
       revenueDateFilter = periodSelect.value;
       monthPicker.hidden = revenueDateFilter !== "month";
       if (revenueDateFilter === "custom") {
           customDates.hidden = false;
           return;
       }
       customDates.hidden = true;
       renderRevenueTab();
   });
   document.getElementById("revenue-month").addEventListener("change", (event) => {
       if (!event.target.value) return;
       revenueMonth = event.target.value;
       revenueDateFilter = "month";
       renderRevenueTab();
   });
   document.querySelectorAll("[data-month-shift]").forEach((button) => {
       button.addEventListener("click", () => {
           const [year, month] = revenueMonth.split("-").map(Number);
           const shiftedMonth = new Date(year, month - 1 + Number(button.dataset.monthShift), 1);
           revenueMonth = `${shiftedMonth.getFullYear()}-${String(shiftedMonth.getMonth() + 1).padStart(2, "0")}`;
           revenueDateFilter = "month";
           renderRevenueTab();
       });
   });
   document.getElementById("revenue-current-month").addEventListener("click", () => {
       const now = new Date();
       revenueMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
       revenueDateFilter = "month";
       renderRevenueTab();
   });
   document.getElementById("revenue-filter-form").addEventListener("submit", (event) => {
       event.preventDefault();
       revenueDateStart = document.getElementById("revenue-date-start").value;
       revenueDateEnd = document.getElementById("revenue-date-end").value;
       if (revenueDateStart && revenueDateEnd && revenueDateStart > revenueDateEnd) {
           alert("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
           return;
       }
       revenueDateFilter = "custom";
       renderRevenueTab();
   });
}

// Shown when products of the original catalog (flower.json) are missing from the shop.
function renderRestoreCatalogNotice() {
   let offlineNotice = "";
   if (FlowerInventory.isFirestoreReachable() === false) {
       offlineNotice = FlowerInventory.areProductsLoaded()
           ? `<div class="restore-catalog-notice" role="alert"><p><strong>Trình duyệt không kết nối trực tiếp được Firestore</strong> (mạng có thể đang chặn Firebase). Sản phẩm đang được đọc qua máy chủ; đơn hàng, ưu đãi và thao tác lưu trên trang này có thể chưa hoạt động. Hãy thử mạng khác (ví dụ 4G) nếu cần chỉnh sửa.</p></div>`
           : `<div class="restore-catalog-notice" role="alert"><p><strong>Không đọc được kho sản phẩm</strong> cả từ trình duyệt lẫn qua máy chủ. Hãy kiểm tra mạng rồi tải lại trang.</p></div>`;
   }
   const missingCount = FlowerInventory.getMissingCatalogProducts().length;
   if (!missingCount) return offlineNotice;
   return offlineNotice + `
       <div class="restore-catalog-notice" role="status">
           <p><strong>Cửa hàng đang thiếu ${missingCount} sản phẩm so với danh mục gốc.</strong>
           Sản phẩm có thể đã bị xóa do lỗi lưu kho trước đây. Khôi phục sẽ thêm lại các sản phẩm còn thiếu với tồn kho ban đầu; sản phẩm đang có giữ nguyên.</p>
           <button class="primary-btn" type="button" data-action="restore-catalog">Khôi phục ${missingCount} sản phẩm</button>
       </div>
   `;
}

async function restoreCatalog() {
   const missingCount = FlowerInventory.getMissingCatalogProducts().length;
   if (!missingCount || !window.confirm(`Thêm lại ${missingCount} sản phẩm còn thiếu từ danh mục gốc?\n\nNếu có sản phẩm bạn cố ý xóa, chúng cũng sẽ được thêm lại; bạn có thể xóa lại sau.`)) return;
   try {
       const restored = await FlowerInventory.restoreCatalogProducts();
       alert(`Đã khôi phục ${restored} sản phẩm.`);
   } catch (error) {
       console.error("Không thể khôi phục sản phẩm:", error);
       alert(error.message || "Chưa thể khôi phục sản phẩm. Hãy thử lại sau.");
   }
   const heading = main.querySelector(".panel h2")?.textContent;
   if (heading === "Quản lý kho hoa") renderProductTab();
   else renderDashboard();
}

function renderProductTab() {
   const products = getProducts();
   const categories = getCategories();
   const searchTerm = productSearchTerm.trim().toLocaleLowerCase("vi");
   const filteredProducts = products.filter((item) =>
       `${item.title} ${item.description || ""} ${item.category || ""}`.toLocaleLowerCase("vi").includes(searchTerm)
   );
   const editingProduct = products.find((item) => String(item.id) === String(editingProductId));
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <h2>Quản lý kho hoa</h2>
               ${renderRestoreCatalogNotice()}
               <form id="product-search-form" class="product-search" role="search">
                   <label class="visually-hidden" for="product-search">Tìm sản phẩm</label>
                   <input id="product-search" name="search" type="search" placeholder="Tìm theo tên hoặc mô tả..." value="${escapeHtml(productSearchTerm)}">
                   <button type="submit" class="secondary-btn">Tìm kiếm</button>
                   ${productSearchTerm ? '<button type="button" class="clear-search" data-action="clear-search">Xóa tìm kiếm</button>' : ""}
               </form>
               <div class="product-table-wrap">
               <table class="product-table">
                   <thead>
                       <tr>
                           <th>Ảnh</th>
                           <th>Tên sản phẩm</th>
                           <th>Phân loại</th>
                           <th>Giá</th>
                           <th>Số lượng</th>
                           <th>Thao tác</th>
                       </tr>
                   </thead>
                   <tbody>
                       ${filteredProducts.map((item) => `
                           <tr>
                               <td><img src="${escapeHtml(getSafeImageUrl(item.image) || "./images/flowerflow-logo.png")}" alt="${escapeHtml(getVietnameseProductName(item.title))}"></td>
                               <td>
                                   <div><strong>${escapeHtml(getVietnameseProductName(item.title))}</strong></div>
                                   <small>${escapeHtml(getVietnameseProductDescription(item.description || ""))}</small>
                               </td>
                               <td>${escapeHtml(item.category || "Chưa phân loại")}</td>
                               <td>${formatVnd(item.price)}</td>
                               <td><input class="qty-input" data-id="${escapeHtml(item.id)}" type="number" min="0" value="${Number(item.quantity) || 0}"></td>
                               <td>
                                   <div class="product-row-actions">
                                       <button class="save-qty" data-id="${escapeHtml(item.id)}" type="button">Lưu tồn kho</button>
                                       <button class="secondary-btn edit-product" data-id="${escapeHtml(item.id)}" type="button">Sửa</button>
                                       <button class="delete-product" data-id="${escapeHtml(item.id)}" type="button">Xóa</button>
                                   </div>
                               </td>
                           </tr>
                       `).join("") || `<tr><td colspan="6" class="empty-state">${products.length ? "Không tìm thấy sản phẩm phù hợp." : "Chưa có sản phẩm nào."}</td></tr>`}
                   </tbody>
               </table>
               </div>
           </div>
           <div class="panel">
               <h2>${editingProduct ? "Chỉnh sửa sản phẩm" : "Thêm hoa mới"}</h2>
               <form id="add-product-form" class="product-form">
                   <input type="text" id="product-title" placeholder="Tên hoa" value="${escapeHtml(getVietnameseProductName(editingProduct?.title || ""))}" required maxlength="120">
                   <input type="text" id="product-image" placeholder="Link hình ảnh (vd ./images/flower-01.webp hoặc https://...)" value="${escapeHtml(editingProduct?.image || "")}" required>
                   <label class="field-label" for="product-category">Phân loại sản phẩm</label>
                   <select id="product-category">
                       <option value="">Chưa phân loại</option>
                       ${categories.map((category) => `<option value="${escapeHtml(category)}" ${editingProduct?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                   </select>
                   <input type="number" id="product-price" placeholder="Giá (VND)" value="${editingProduct ? escapeHtml(editingProduct.price) : ""}" min="1000" step="1000" required>
                   <input type="number" id="product-quantity" placeholder="Số lượng" value="${editingProduct ? Number(editingProduct.quantity) || 0 : ""}" data-shown-value="${editingProduct ? Number(editingProduct.quantity) || 0 : ""}" min="0" step="1" required>
                   <textarea id="product-description" placeholder="Mô tả sản phẩm" required maxlength="1000">${escapeHtml(editingProduct?.description || "")}</textarea>
                   <div class="product-form-actions">
                       <button type="submit" class="submit-btn">${editingProduct ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
                       ${editingProduct ? '<button type="button" class="secondary-btn" data-action="cancel-edit">Hủy</button>' : ""}
                   </div>
               </form>
           </div>
       </section>
   `;
}

function renderCategoriesTab() {
   const categories = getCategories();
   const products = getProducts();
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <h2>Quản lý phân loại</h2>
               <p class="category-help">Tạo danh mục để nhóm sản phẩm. Xóa danh mục sẽ chuyển sản phẩm thuộc danh mục đó về trạng thái chưa phân loại.</p>
               <form id="add-category-form" class="category-form">
                   <label class="visually-hidden" for="category-name">Tên phân loại</label>
                   <input id="category-name" name="category" type="text" placeholder="Ví dụ: Hoa sinh nhật" maxlength="80" required>
                   <button class="submit-btn" type="submit">Thêm phân loại</button>
               </form>
               <div class="category-list">
                   ${categories.map((category) => {
                       const productCount = products.filter((product) => product.category === category).length;
                       return `
                           <article class="category-row">
                               <div>
                                   <strong>${escapeHtml(category)}</strong>
                                   <span>${productCount} sản phẩm</span>
                               </div>
                               <div class="product-row-actions">
                                   <button class="secondary-btn edit-category" data-category="${escapeHtml(category)}" type="button">Đổi tên</button>
                                   <button class="delete-product delete-category" data-category="${escapeHtml(category)}" type="button">Xóa</button>
                               </div>
                           </article>
                       `;
                   }).join("") || '<div class="empty-state">Chưa có phân loại. Hãy thêm phân loại đầu tiên.</div>'}
               </div>
           </div>
       </section>
   `;
}

function renderOffersTab() {
   const offers = getOffers();
   const products = getProducts();
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <h2>Thêm ưu đãi</h2>
               <p class="category-help">Chọn sản phẩm và phần trăm giảm giá. Tiền giảm = giá × số lượng × phần trăm giảm. Mỗi đơn chỉ áp dụng một ưu đãi; trang thanh toán tự chọn ưu đãi giúp khách giảm được nhiều tiền nhất.</p>
               <form id="add-offer-form" class="offer-form">
                   <label>
                       <span class="field-label">Tên ưu đãi</span>
                       <input id="offer-name" name="name" type="text" maxlength="80" placeholder="Ví dụ: Ưu đãi mùa hè" required>
                   </label>
                   <label>
                       <span class="field-label">Phần trăm giảm (%)</span>
                       <input id="offer-percent" name="percent" type="number" min="0.01" max="100" step="0.01" placeholder="10" required>
                   </label>
                   <fieldset class="offer-products">
                       <legend>Chọn sản phẩm áp dụng</legend>
                       <button class="secondary-btn offer-select-all" data-offer-select-all type="button" ${products.length ? "" : "disabled"}>Chọn tất cả hoa / bỏ chọn tất cả</button>
                       ${products.map((product) => `
                           <label class="offer-product-option">
                               <input type="checkbox" name="productIds" value="${escapeHtml(product.id)}">
                               <span>${escapeHtml(getVietnameseProductName(product.title))}</span>
                               <small>${formatVnd(product.price)}</small>
                           </label>
                       `).join("") || '<p class="empty-state">Chưa có sản phẩm để áp dụng ưu đãi.</p>'}
                   </fieldset>
                   <button class="submit-btn" type="submit" ${products.length ? "" : "disabled"}>Tạo ưu đãi</button>
               </form>
           </div>
           <div class="panel">
               <h2>Danh sách ưu đãi</h2>
               <div class="offer-list">
                   ${offers.map((offer) => {
                       const productCount = Array.isArray(offer.productIds) ? offer.productIds.length : 0;
                       return `
                           <article class="offer-row">
                               <div>
                                   <strong>${escapeHtml(offer.name)}</strong>
                                   <span>Giảm ${Number(offer.discountPercent)}% · ${productCount} sản phẩm</span>
                                   ${offer.allProducts === true ? '<span>Áp dụng cho tất cả hoa</span>' : ""}
                                   <span class="offer-status ${offer.active ? "is-active" : "is-inactive"}">${offer.active ? "Đang áp dụng" : "Đã tạm dừng"}</span>
                               </div>
                               <div class="product-row-actions">
                                   <button class="secondary-btn" data-offer-action="toggle" data-offer-id="${escapeHtml(offer.id)}" type="button">${offer.active ? "Tạm dừng" : "Kích hoạt"}</button>
                                   <button class="delete-product" data-offer-action="delete" data-offer-id="${escapeHtml(offer.id)}" type="button">Xóa</button>
                               </div>
                           </article>
                       `;
                   }).join("") || '<div class="empty-state">Chưa có ưu đãi nào.</div>'}
               </div>
           </div>
       </section>
   `;
}

async function addOffer(event) {
   event.preventDefault();
   const form = event.target;
   if (!(form instanceof HTMLFormElement)) {
       console.error("Không thể tạo ưu đãi: biểu mẫu không hợp lệ.");
       return;
   }
   const formData = new FormData(form);
   const name = String(formData.get("name") || "").trim();
   const discountPercent = Number(formData.get("percent"));
   const productIds = formData.getAll("productIds").map(String);

   if (!name || !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
       alert("Vui lòng nhập tên ưu đãi và phần trăm giảm lớn hơn 0%, tối đa 100%.");
       return;
   }
   if (!productIds.length) {
       alert("Vui lòng chọn ít nhất một sản phẩm áp dụng.");
       return;
   }

   const allProductIds = new Set(getProducts().map((product) => String(product.id)));
   const selectedProductIds = new Set(productIds);
   const newOffer = {
       id: (window.crypto && typeof window.crypto.randomUUID === "function")
           ? window.crypto.randomUUID()
           : String(Date.now()),
       name,
       discountPercent,
       productIds,
       allProducts: allProductIds.size > 0
           && productIds.length === allProductIds.size
           && [...allProductIds].every((id) => selectedProductIds.has(id)),
       active: true,
       createdAt: new Date().toISOString()
   };
   try {
       await updateOffers((offers) => [...offers, newOffer]);
   } catch (error) {
       console.error("Không thể lưu ưu đãi dùng chung:", error);
       alert("Chưa thể lưu ưu đãi lên hệ thống. Hãy thử lại sau.");
       return;
   }
   renderOffersTab();
}

async function updateOffer(offerId, action) {
   const offers = getOffers();
   const offer = offers.find((item) => String(item.id) === String(offerId));
   if (!offer) return;

   if (action === "delete") {
       if (!window.confirm(`Xóa ưu đãi “${offer.name}”?`)) return;
       try {
           await updateOffers((latest) => latest.filter((item) => String(item.id) !== String(offerId)));
       } catch (error) {
           console.error("Không thể xóa ưu đãi dùng chung:", error);
           alert("Chưa thể cập nhật ưu đãi trên hệ thống. Hãy thử lại sau.");
           return;
       }
   } else {
       try {
           const active = !offer.active;
           await updateOffers((latest) => latest.map((item) => String(item.id) === String(offerId)
               ? { ...item, active }
               : item
           ));
       } catch (error) {
           console.error("Không thể cập nhật ưu đãi dùng chung:", error);
           alert("Chưa thể cập nhật ưu đãi trên hệ thống. Hãy thử lại sau.");
           return;
       }
   }
   renderOffersTab();
}

function addCategory(event) {
   event.preventDefault();
   const input = document.getElementById("category-name");
   const category = input.value.trim();
   if (!category) {
       alert("Vui lòng nhập tên phân loại.");
       return;
   }
   if (getCategories().some((existing) => existing.toLocaleLowerCase("vi") === category.toLocaleLowerCase("vi"))) {
       alert("Phân loại này đã tồn tại.");
       input.focus();
       return;
   }
   saveCategories([...getCategories(), category]);
   renderCategoriesTab();
}

async function renameCategory(oldCategory) {
   const newCategory = window.prompt("Nhập tên phân loại mới:", oldCategory)?.trim();
   if (!newCategory || newCategory === oldCategory) return;
   if (getCategories().some((category) => category.toLocaleLowerCase("vi") === newCategory.toLocaleLowerCase("vi"))) {
       alert("Phân loại này đã tồn tại.");
       return;
   }

   const categories = getCategories().map((category) => category === oldCategory ? newCategory : category);
   if (!await saveAdminProducts(getProducts().map((product) =>
       product.category === oldCategory ? { ...product, category: newCategory } : product
   ))) return;
   saveCategories(categories);
   renderCategoriesTab();
}

async function deleteCategory(category) {
   const productCount = getProducts().filter((product) => product.category === category).length;
   const message = productCount
       ? `Xóa phân loại “${category}” và bỏ phân loại khỏi ${productCount} sản phẩm?`
       : `Xóa phân loại “${category}”?`;
   if (!window.confirm(message)) return;

   const categories = getCategories().filter((existing) => existing !== category);
   if (!await saveAdminProducts(getProducts().map((product) =>
       product.category === category ? { ...product, category: "" } : product
   ))) return;
   saveCategories(categories);
   renderCategoriesTab();
}

function getProductById(productId) {
   const products = getProducts();
   return products.find((product) => String(product.id) === String(productId));
}

async function saveAdminProducts(products) {
   try {
       await FlowerInventory.saveProducts(products);
       return true;
   } catch (error) {
       console.error("Could not synchronize product catalog:", error);
       alert("Không thể đồng bộ thay đổi sản phẩm với kho dữ liệu chung. Vui lòng thử lại.");
       return false;
   }
}

function renderCompletionAction(type, record) {
   const attributes = `data-record-type="${escapeHtml(type)}" data-record-id="${escapeHtml(record.id)}"`;
   const deleteButton = `<button class="delete-record" ${attributes} type="button">Xóa</button>`;
   if (record.completedAt) {
       return `<button class="restore-record" ${attributes} type="button">Khôi phục</button>${deleteButton}`;
   }
   return `<button class="complete-record" ${attributes} type="button">Hoàn thành</button>${deleteButton}`;
}

function renderCompletedSection(records, renderCard, label) {
   return `
       <section class="completed-section">
           <h3>Hoàn thành (${records.length})</h3>
           <div class="list-stack">
               ${records.length ? records.map(renderCard).join("") : `<div class="empty-state">Chưa có ${label} nào hoàn thành.</div>`}
           </div>
       </section>
   `;
}

function renderCompletedOrderSummary(order) {
   return renderOrderSummary(order);
}

function renderActiveOrderSummary(order) {
   return renderOrderSummary(order);
}

function renderOrderSummary(order) {
   const itemSummary = (order.items || [])
       .map((item) => `${escapeHtml(getVietnameseProductName(item.title))} × ${Number(item.quantity) || 0}`)
       .join(", ") || "Không có sản phẩm";
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>Đơn #${escapeHtml(order.id)} · ${escapeHtml(order.customerName)}</strong>
               <span><b>Sản phẩm:</b> ${itemSummary}</span>
               <span><b>Thời gian đặt:</b> ${new Date(order.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="orders" data-record-id="${escapeHtml(order.id)}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="orders:${escapeHtml(order.id)}" hidden>
               ${renderOrderCard(order)}
           </div>
       </article>
   `;
}

function renderOrderCard(order, showCompletionAction = true) {
   const items = order.items || [];
   return `
       <div class="order-item content-card">
           <div class="card-header">
               <div>
                   <div class="title-row">
                       <span class="card-icon">🧾</span>
                       <strong>Đơn #${escapeHtml(order.id)} - ${escapeHtml(order.customerName)}</strong>
                   </div>
                   <div class="order-meta">
                       <span>📞 ${escapeHtml(order.phone)}</span>
                       <span>🕒 ${new Date(order.createdAt).toLocaleString("vi-VN")}</span>
                       ${order.savings != null ? `<span>🎁 Ưu đãi: ${moneyFormat(order.savings)}</span>` : ""}
                       <span>💰 ${moneyFormat(order.total)}</span>
                   </div>
               </div>
               <span class="status-badge">${escapeHtml(normalizeOrderStatus(order.status))}</span>
           </div>

           <div class="info-grid two-col">
               <div class="field">
                   <span class="field-label">Khách hàng</span>
                   <span class="field-value">${escapeHtml(order.customerName)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Điện thoại</span>
                   <span class="field-value">${escapeHtml(order.phone)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Thanh toán</span>
                   <span class="field-value">${escapeHtml(getPaymentDisplayStatus(order))}</span>
               </div>
               <div class="field full-width">
                   <span class="field-label">Địa chỉ</span>
                   <span class="field-value">${escapeHtml(order.address || "Chưa cập nhật")}</span>
               </div>
           </div>

           ${String(order.orderNote || "").trim() ? `
               <div class="section-label">Lời nhắn của khách</div>
               <div class="detail-block quote-box">${escapeHtml(order.orderNote)}</div>
               ${order.orderNoteReply ? `<div class="reply-banner"><strong>Cửa hàng đã trả lời:</strong> ${escapeHtml(order.orderNoteReply)}</div>` : ""}
           ` : ""}

           <div class="section-label">Sản phẩm trong đơn</div>
           <div class="order-product-list">
               ${items.map((item) => {
                   const product = getProductById(item.id) || {};
                   const image = getSafeImageUrl(item.image || product.image) || "./images/flowerflow-logo.png";
                   return `
                       <div class="product-card">
                           <img src="${escapeHtml(image)}" alt="${escapeHtml(getVietnameseProductName(item.title))}">
                           <div class="product-card-content">
                               <strong>${escapeHtml(getVietnameseProductName(item.title))}</strong>
                               <span>Số lượng: ${Number(item.quantity) || 0}</span>
                               <span>Giá: ${moneyFormat(item.price)}</span>
                           </div>
                       </div>
                   `;
               }).join("")}
           </div>

           ${!order.completedAt ? `
               <div class="reply-box compact-box">
                   <label class="field-label">Lịch trình vận chuyển</label>
                   <div class="tracking-admin-fields">
                       <label>
                           Vị trí hiện tại
                           <input class="tracking-location" data-order-id="${escapeHtml(order.id)}" value="${escapeHtml(order.currentLocation || "")}" placeholder="Ví dụ: Đang giao tại Quận 1">
                       </label>
                       <label>
                           Dự kiến giao đến
                           <input class="tracking-eta" data-order-id="${escapeHtml(order.id)}" type="date" value="${escapeHtml(toDateInput(order.estimatedDelivery))}">
                       </label>
                   </div>
               </div>
           ` : ""}

           ${order.completedAt ? `
               <div class="completion-meta">Hoàn thành lúc ${new Date(order.completedAt).toLocaleString("vi-VN")}</div>
               ${showCompletionAction ? `<div class="status-row">${renderCompletionAction("orders", order)}</div>` : ""}
           ` : `
               <div class="reply-box compact-box">
                   <label class="field-label">Cập nhật trạng thái</label>
                   <div class="status-row">
                       <select class="status-select" data-order-id="${escapeHtml(order.id)}">
                           ${ORDER_STATUSES.map((status) => `
                               <option value="${status}" ${status === normalizeOrderStatus(order.status) ? "selected" : ""}>${status}</option>
                           `).join("")}
                       </select>
                       <button class="status-save" data-order-id="${escapeHtml(order.id)}">Cập nhật trạng thái</button>
                       ${order.paymentMethod === "qr" && order.paymentVerified !== true && normalizeOrderStatus(order.status) !== "Đã hủy"
                           ? `<button class="secondary-btn verify-payment" data-order-id="${escapeHtml(order.id)}" type="button">Xác nhận đã nhận tiền</button>`
                           : ""}
                       ${order.paymentMethod === "qr" && order.paymentVerified !== true && normalizeOrderStatus(order.status) === "Đã hủy"
                           ? `<button class="secondary-btn record-late-payment" data-order-id="${escapeHtml(order.id)}" type="button">Ghi nhận tiền chuyển trễ</button>`
                           : ""}
                       ${showCompletionAction ? renderCompletionAction("orders", order) : ""}
                   </div>
               </div>
           `}
       </div>
   `;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
         "&": "&amp;",
         "<": "&lt;",
         ">": "&gt;",
         '"': "&quot;",
         "'": "&#39;"
    })[character]);
}

function getSafeImageUrl(value) {
   const imageUrl = String(value || "").trim();
   if (!imageUrl) return null;
   try {
       const parsedUrl = new URL(imageUrl, window.location.href);
       return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl.href : null;
   } catch {
       return null;
   }
}

// Value to store for a product image: same-site images stay relative ("./images/..."),
// so they keep working on every domain; other sites keep their full https URL.
function getStoredImageUrl(value) {
   const safeImageUrl = getSafeImageUrl(value);
   if (!safeImageUrl) return null;
   const parsedUrl = new URL(safeImageUrl);
   return parsedUrl.origin === window.location.origin
       ? `.${parsedUrl.pathname}${parsedUrl.search}`
       : safeImageUrl;
}

function toDateInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function renderOrdersTab() {
   if (orderStoreError) {
       main.innerHTML = `<section class="panel"><h2>Quản lý đơn hàng</h2><p class="empty-state">Không thể tải đơn hàng dùng chung. Kiểm tra cấu hình Firestore và quyền truy cập rồi tải lại trang.</p></section>`;
       return;
   }
   const statusPriority = {
       "Chờ xác nhận": 0,
       "Đang giao": 1,
       "Đã giao": 2,
       "Đã hủy": 3
   };
   const sortedOrders = getOrders().sort((first, second) => {
       const priorityDifference = (statusPriority[normalizeOrderStatus(first.status)] ?? 1)
           - (statusPriority[normalizeOrderStatus(second.status)] ?? 1);
       if (priorityDifference !== 0) return priorityDifference;
       return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
   });
   const orders = sortedOrders.filter((order) => !order.completedAt);
   const completedOrders = sortedOrders.filter((order) => order.completedAt);
   main.innerHTML = `
       <section class="panel">
           <h2>Quản lý đơn hàng</h2>
           <div class="list-stack">
               ${orders.length ? orders.map(renderActiveOrderSummary).join("") : '<div class="empty-state">Không có đơn hàng nào cần xử lý.</div>'}
           </div>
           ${renderCompletedSection(completedOrders, renderCompletedOrderSummary, "đơn hàng")}
       </section>
   `;
}

function refreshOrdersView() {
   const heading = main.querySelector(".panel h2")?.textContent;
   if (heading === "Quản lý đơn hàng") rerenderKeepingEdits(renderOrdersTab);
   else if (heading === "Phản hồi từ khách hàng") rerenderKeepingEdits(renderMessagesTab);
   else if (heading === "Doanh thu & kho hàng") renderRevenueTab();
   else if (main.querySelector(".dashboard") || !heading) renderDashboard();
}

function renderReviewCard(review, showCompletionAction = true) {
   return `
       <div class="review-item feedback-card content-card">
           <div class="card-header">
               <div>
                   <div class="title-row">
                       <span class="card-icon">⭐</span>
                       <strong>${escapeHtml(review.customerName)}</strong>
                   </div>
                   <div class="review-meta">
                       ${review.phone ? `<span>📞 ${escapeHtml(review.phone)}</span>` : ""}
                       <span>🕒 ${new Date(review.createdAt).toLocaleString("vi-VN")}</span>
                   </div>
               </div>
               <div class="card-actions">
                   <span class="card-tag card-tag-review">Đánh giá</span>
                   ${showCompletionAction ? renderCompletionAction("reviews", review) : ""}
               </div>
           </div>

           <div class="info-grid two-col">
               <div class="field">
                   <span class="field-label">Sản phẩm</span>
                   <span class="field-value">${escapeHtml(getVietnameseProductName(review.productName))}</span>
               </div>
               <div class="field">
                   <span class="field-label">Xếp hạng</span>
                   <span class="field-value rating-value">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</span>
               </div>
           </div>

           <div class="section-label">Nội dung đánh giá</div>
           <div class="detail-block quote-box">${escapeHtml(review.comment || "Không có nhận xét")}</div>

           <div class="reply-box">
               <label class="field-label">Phản hồi của bạn</label>
               <textarea class="reply-input" data-review-id="${escapeHtml(review.id)}" placeholder="Nhập phản hồi cho khách hàng...">${escapeHtml(review.reply || "")}</textarea>
               <button class="send-reply" data-review-id="${escapeHtml(review.id)}">Gửi phản hồi</button>
           </div>
       </div>
   `;
}

function renderCompletedReviewSummary(review) {
   return renderReviewSummary(review);
}

function renderActiveReviewSummary(review) {
   return renderReviewSummary(review);
}

function renderReviewSummary(review) {
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>${escapeHtml(review.customerName)} · ${escapeHtml(getVietnameseProductName(review.productName))}</strong>
               <span class="rating-value">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</span>
               <span class="record-summary-preview"><b>Đánh giá:</b> ${escapeHtml(review.comment || "Không có nhận xét")}</span>
               <span><b>Thời gian:</b> ${new Date(review.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="reviews" data-record-id="${escapeHtml(review.id)}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="reviews:${escapeHtml(review.id)}" hidden>
               ${renderReviewCard(review)}
           </div>
       </article>
   `;
}

function renderReviewsTab() {
   const reviews = getReviews();
   const activeReviews = reviews.filter((review) => !review.completedAt);
   const completedReviews = reviews.filter((review) => review.completedAt);
   main.innerHTML = `
       <section class="panel">
           <h2>Đánh giá khách hàng</h2>
           <div class="list-stack">
               ${activeReviews.length ? activeReviews.map(renderActiveReviewSummary).join("") : '<div class="empty-state">Không có đánh giá nào cần xử lý.</div>'}
           </div>
           ${renderCompletedSection(completedReviews, renderCompletedReviewSummary, "đánh giá")}
       </section>
   `;
}

function renderMessageCard(message, showCompletionAction = true) {
   return `
       <div class="message-item feedback-card content-card">
           <div class="card-header">
               <div>
                   <div class="title-row">
                       <span class="card-icon">💬</span>
                       <strong>${escapeHtml(message.customerName)}</strong>
                   </div>
                   <div class="message-meta">
                       <span>📞 ${escapeHtml(message.phone)}</span>
                       <span>🕒 ${new Date(message.createdAt).toLocaleString("vi-VN")}</span>
                   </div>
               </div>
               <div class="card-actions">
                   <span class="card-tag card-tag-message">Phản hồi</span>
                   ${showCompletionAction ? renderCompletionAction("messages", message) : ""}
               </div>
           </div>

           <div class="info-grid single-col">
               <div class="field">
                   <span class="field-label">Chủ đề</span>
                   <span class="field-value">${escapeHtml(message.subject || "Tư vấn đặt hàng")}</span>
               </div>
           </div>

           <div class="section-label">Nội dung khách nhắn</div>
           <div class="detail-block quote-box">${escapeHtml(message.message)}</div>
           ${message.reply ? `<div class="reply-banner"><strong>Phản hồi của bạn:</strong> ${escapeHtml(message.reply)}</div>` : ""}

           <div class="reply-box">
               <label class="field-label">Trả lời khách</label>
               <textarea class="reply-input" data-message-id="${escapeHtml(message.id)}" placeholder="Nhập câu trả lời cho khách hàng...">${escapeHtml(message.reply || "")}</textarea>
               <button class="send-reply" data-message-id="${escapeHtml(message.id)}">Trả lời</button>
           </div>
       </div>
   `;
}

function renderCompletedMessageSummary(message) {
   return renderMessageSummary(message);
}

function renderActiveMessageSummary(message) {
   return renderMessageSummary(message);
}

function renderMessageSummary(message) {
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>${escapeHtml(message.customerName)} · ${escapeHtml(message.subject || "Tư vấn đặt hàng")}</strong>
               <span class="record-summary-preview"><b>Nội dung:</b> ${escapeHtml(message.message)}</span>
               <span><b>Thời gian:</b> ${new Date(message.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="messages" data-record-id="${escapeHtml(message.id)}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="messages:${escapeHtml(message.id)}" hidden>
               ${renderMessageCard(message)}
           </div>
       </article>
   `;
}

function renderMessagesTab() {
   const messages = getMessages();
   const activeMessages = messages.filter((message) => !message.completedAt);
   const completedMessages = messages.filter((message) => message.completedAt);
   main.innerHTML = `
       <section class="panel">
           <h2>Phản hồi từ khách hàng</h2>
           <div class="list-stack">
               ${activeMessages.length ? activeMessages.map(renderActiveMessageSummary).join("") : '<div class="empty-state">Không có phản hồi nào cần xử lý.</div>'}
           </div>
           ${renderCompletedSection(completedMessages, renderCompletedMessageSummary, "phản hồi")}
       </section>
   `;
}

// Stock is a whole number of bouquets; the order API rejects anything else.
function parseStockQuantity(value) {
   const text = String(value ?? "").trim();
   if (!/^\d+$/.test(text)) return null;
   const quantity = Number(text);
   return Number.isSafeInteger(quantity) ? quantity : null;
}

async function saveProductQuantity(id, value) {
   const quantity = parseStockQuantity(value);
   if (quantity === null) {
       alert("Số lượng phải là số nguyên từ 0 trở lên (ví dụ 0, 5, 12).");
       return;
   }
   const products = getProducts();
   const nextProducts = products.map((item) => {
       if (String(item.id) === String(id)) {
           return { ...item, quantity };
       }
       return item;
   });
    if (!await saveAdminProducts(nextProducts)) return;
   renderProductTab();
   alert("Đã lưu tồn kho.");
}

async function addNewProduct(event) {
   event.preventDefault();
   const title = document.getElementById("product-title").value.trim();
   const image = document.getElementById("product-image").value.trim();
   const safeImageUrl = getStoredImageUrl(image);
    const priceInVnd = Number(document.getElementById("product-price").value);
   const quantity = parseStockQuantity(document.getElementById("product-quantity").value);
   const description = document.getElementById("product-description").value.trim();
   const category = document.getElementById("product-category").value;

    if (!title || !safeImageUrl || !description || !Number.isFinite(priceInVnd) || priceInVnd < 1) {
       alert("Vui lòng nhập đầy đủ thông tin.");
       return;
   }
   if (!Number.isSafeInteger(priceInVnd) || priceInVnd < 1000) {
       alert("Giá phải là số nguyên VND từ 1.000 trở lên (ví dụ 450000).");
       return;
   }
   if (quantity === null) {
       alert("Số lượng phải là số nguyên từ 0 trở lên (ví dụ 0, 5, 12).");
       return;
   }

   const products = getProducts();
    const productData = { title, image: safeImageUrl, price: priceInVnd, quantity, description, category };
   const isEditing = editingProductId !== null;
   // Keep the live stock if the admin did not touch the quantity: orders may have changed it
   // since the form was opened.
   const quantityInput = document.getElementById("product-quantity");
   if (isEditing && quantityInput.value === quantityInput.dataset.shownValue) delete productData.quantity;
   const nextProducts = isEditing
       ? products.map((item) => String(item.id) === String(editingProductId) ? { ...item, ...productData } : item)
       : [...products, { id: Date.now(), ...productData }];

    if (!await saveAdminProducts(nextProducts)) return;
   editingProductId = null;
   alert(isEditing ? "Cập nhật sản phẩm thành công!" : "Thêm sản phẩm thành công!");
   renderProductTab();
}

async function deleteProduct(id) {
   const product = getProductById(id);
   if (!product || !window.confirm(`Bạn có chắc muốn xóa “${getVietnameseProductName(product.title)}”?`)) return;

   const products = getProducts().filter((item) => String(item.id) !== String(id));
    if (!await saveAdminProducts(products)) return;
   if (String(editingProductId) === String(id)) editingProductId = null;
   renderProductTab();
}

async function updateOrderStatus(orderId, status, location, estimatedDelivery) {
    if (!ORDER_STATUSES.includes(status)) {
        alert("Trạng thái đơn hàng không hợp lệ.");
        return;
    }
    if (status === "Đang giao" && (!location || !estimatedDelivery)) {
        alert("Vui lòng nhập vị trí hiện tại và ngày dự kiến giao hàng.");
        return;
    }

   const order = getOrders().find((item) => String(item.id) === String(orderId));
   if (!order) {
       alert("Không tìm thấy đơn hàng trên hệ thống dùng chung.");
       return;
   }
   // Restoring a cancelled order: do not keep showing "the order expired" as its location.
   if (normalizeOrderStatus(order.status) === "Đã hủy" && status !== "Đã hủy" && location === (order.currentLocation || "")) {
       location = "Đơn hàng đã được cửa hàng khôi phục";
   }
   // A delivered order being cancelled: only put the flowers back in stock if they came back.
   const wasDelivered = normalizeOrderStatus(order.status) === "Đã giao";
   const restockSold = status === "Đã hủy" && wasDelivered
       && window.confirm("Đơn này đã giao. Hoa có được trả lại cửa hàng không?\n\nOK: cộng lại số lượng vào kho.\nCancel: chỉ hủy đơn, không đổi tồn kho.");
   const updatedAt = new Date().toISOString();
   const markCodAsPaid = status === "Đã giao"
       && order.paymentMethod === "cod"
       && !isOrderPaid(order);
   try {
       await window.FlowerOrderStore.update(orderId, {
           status,
           ...(markCodAsPaid ? { paymentStatus: "Đã thanh toán", paidAt: updatedAt } : {}),
           currentLocation: location,
           estimatedDelivery,
           trackingUpdatedAt: updatedAt
       }, {
           restockSold,
           expectedStatus: order.status,
           newEvent: { status, location, estimatedDelivery, updatedAt }
       });
   } catch (error) {
       console.error("Không thể cập nhật đơn hàng trên Firestore:", error);
       alert(error.code ? error.message : "Chưa thể cập nhật đơn hàng dùng chung. Hãy thử lại sau.");
       if (error.code === "order-changed") renderOrdersTab();
   }
}

async function verifyOrderPayment(orderId) {
   const order = getOrders().find((item) => String(item.id) === String(orderId));
   if (!order) return;
   const confirmed = window.confirm(
       `Xác nhận đã nhận ${moneyFormat(order.total)} cho đơn #${order.id}` +
       (order.paymentReference ? ` (nội dung ${order.paymentReference})` : "") +
       "? Chỉ xác nhận sau khi đã kiểm tra sao kê ngân hàng."
   );
   if (!confirmed) return;
   try {
       await window.FlowerOrderStore.verifyPayment(orderId);
   } catch (error) {
       console.error("Không thể xác nhận thanh toán trên Firestore:", error);
       alert(error.code === "order-cancelled" ? error.message : "Chưa thể xác nhận thanh toán. Hãy thử lại sau.");
   }
}

async function recordLateOrderPayment(orderId) {
   const order = getOrders().find((item) => String(item.id) === String(orderId));
   if (!order) return;
   const confirmed = window.confirm(
       `Ghi nhận khách đã chuyển ${moneyFormat(order.total)} cho đơn #${order.id} sau khi đơn bị hủy` +
       (order.paymentReference ? ` (nội dung ${order.paymentReference})` : "") +
       "?\n\nSau đó hãy khôi phục đơn (chọn lại trạng thái “Chờ xác nhận”) hoặc hoàn tiền cho khách."
   );
   if (!confirmed) return;
   try {
       await window.FlowerOrderStore.recordLatePayment(orderId);
       alert("Đã ghi nhận tiền chuyển trễ. Đơn được đánh dấu cần khôi phục hoặc hoàn tiền.");
   } catch (error) {
       console.error("Không thể ghi nhận thanh toán trễ:", error);
       alert(error.code ? error.message : "Chưa thể ghi nhận thanh toán. Hãy thử lại sau.");
   }
}

async function updateReviewReply(reviewId, reply) {
   try {
       await window.FlowerReviewStore.update(reviewId, { reply });
       alert(reply.trim()
           ? "Đã lưu phản hồi. Khách sẽ thấy ở trang sản phẩm và trang theo dõi đơn hàng."
           : "Đã xóa phản hồi.");
   } catch (error) {
       console.error("Không thể lưu phản hồi đánh giá:", error);
       alert("Chưa thể lưu phản hồi. Hãy thử lại sau.");
   }
}

async function updateMessageReply(messageId, reply) {
   const message = getMessages().find((item) => String(item.id) === String(messageId));
   if (!message) return;
   try {
       if (message.source === "legacy") {
           await window.FlowerMessageStore.updateAdminMessage(messageId, { reply });
       } else {
           await window.FlowerOrderStore.update(messageId, { orderNoteReply: reply });
       }
   } catch (error) {
       console.error("Không thể lưu câu trả lời:", error);
       alert("Chưa thể lưu câu trả lời. Hãy thử lại sau.");
   }
}

async function deleteAdminRecord(type, id) {
   const records = {
       orders: { label: "đơn hàng", render: renderOrdersTab },
       reviews: { label: "đánh giá", render: renderReviewsTab },
       messages: { label: "lời nhắn", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể xóa mục admin không hợp lệ:", type);
       return;
   }

   const warning = type === "orders"
       ? "Bạn có chắc muốn xóa đơn hàng này không? Nếu đơn còn đang giữ hàng, số lượng sẽ được trả lại kho. Không thể hoàn tác."
       : type === "messages"
           ? "Ẩn lời nhắn này khỏi danh sách phản hồi? Ghi chú gốc vẫn được giữ trong đơn hàng."
           : `Bạn có chắc muốn xóa ${record.label} này không? Không thể hoàn tác.`;
   if (!window.confirm(warning)) return;

   if (type === "orders") {
       try {
           await window.FlowerOrderStore.remove(id);
       } catch (error) {
           console.error("Không thể xóa đơn hàng trên Firestore:", error);
           alert("Chưa thể xóa đơn hàng dùng chung. Hãy thử lại sau.");
       }
       return;
   }

   try {
       if (type === "reviews") await window.FlowerReviewStore.remove(id);
       else {
           const message = getMessages().find((item) => String(item.id) === String(id));
           if (message?.source === "legacy") await window.FlowerMessageStore.deleteAdminMessage(id);
           // The note belongs to the order: hide it from this list, never erase it.
           else if (message) await window.FlowerOrderStore.update(id, {
               orderNoteArchivedAt: new Date().toISOString()
           });
       }
   } catch (error) {
       console.error(`Không thể xóa ${record.label} trên Firestore:`, error);
       alert(`Chưa thể xóa ${record.label}. Hãy thử lại sau.`);
   }
}

async function setRecordCompletion(type, id, completed) {
   const records = {
       orders: { label: "đơn hàng", render: renderOrdersTab },
       reviews: { label: "đánh giá", render: renderReviewsTab },
       messages: { label: "lời nhắn", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể cập nhật mục hoàn thành không hợp lệ:", type);
       return;
   }

   if (type === "orders") {
       try {
           await window.FlowerOrderStore.update(id, {
               completedAt: completed ? new Date().toISOString() : null
           });
       } catch (error) {
           console.error("Không thể cập nhật đơn hàng trên Firestore:", error);
           alert("Chưa thể cập nhật đơn hàng dùng chung. Hãy thử lại sau.");
       }
       return;
   }

   const completedAt = completed ? new Date().toISOString() : null;
   try {
       if (type === "reviews") await window.FlowerReviewStore.update(id, { completedAt });
       else {
           const message = getMessages().find((item) => String(item.id) === String(id));
           if (message?.source === "legacy") {
               await window.FlowerMessageStore.updateAdminMessage(id, { completedAt });
           } else if (message) {
               await window.FlowerOrderStore.update(id, { orderNoteCompletedAt: completedAt });
           }
       }
   } catch (error) {
       console.error(`Không thể cập nhật ${record.label} trên Firestore:`, error);
       alert(`Chưa thể cập nhật ${record.label}. Hãy thử lại sau.`);
   }
}

function renderUsersTab() {
   main.innerHTML = `
       <section class="panel">
           <div class="users-heading">
               <div>
                   <h2>Tài khoản Firebase</h2>
                   <p class="users-description">Thông tin tài khoản và phương thức đăng nhập. Danh sách Firebase không trả về mật khẩu.</p>
               </div>
               <button class="primary-btn" id="refresh-users" type="button">Tải lại</button>
           </div>
           <div class="table-wrap">
               <table class="users-table">
                   <thead>
                       <tr>
                           <th>Tên</th>
                           <th>Email</th>
                           <th>Phương thức</th>
                           <th>UID</th>
                           <th>Tạo tài khoản</th>
                           <th>Đăng nhập gần nhất</th>
                           <th>Trạng thái</th>
                       </tr>
                   </thead>
                   <tbody id="firebase-users"></tbody>
               </table>
           </div>
           <p class="users-status" id="users-status" role="status" aria-live="polite"></p>
           <button class="secondary-btn" id="load-more-users" type="button" hidden>Tải thêm</button>
       </section>
   `;
   loadFirebaseUsers();

   document.getElementById("refresh-users").addEventListener("click", () => loadFirebaseUsers());
   document.getElementById("load-more-users").addEventListener("click", (event) => {
       loadFirebaseUsers(event.currentTarget.dataset.pageToken);
   });
}

function formatUserDate(value) {
   if (!value) return "Chưa có";
   const date = new Date(value);
   return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

async function loadFirebaseUsers(pageToken) {
   const status = document.getElementById("users-status");
   const tbody = document.getElementById("firebase-users");
   const loadMore = document.getElementById("load-more-users");
   const refresh = document.getElementById("refresh-users");
   if (!status || !tbody || !loadMore || !refresh) return;

   status.textContent = "Đang tải danh sách tài khoản...";
   loadMore.hidden = true;
   refresh.disabled = true;
   try {
       const idToken = await currentUser.getIdToken();
       const httpResponse = await fetch("/api/admin/users", {
           method: "POST",
           headers: {
               "Authorization": `Bearer ${idToken}`,
               "Content-Type": "application/json"
           },
           body: JSON.stringify({
           pageToken: pageToken || null
           })
       });
       const data = await httpResponse.json();
       if (!httpResponse.ok) {
           const error = new Error(data.error || "Không thể tải danh sách tài khoản.");
           error.code = data.code;
           throw error;
       }
       const response = { data };
       if (!pageToken) tbody.replaceChildren();

       response.data.users.forEach((user) => {
           const row = document.createElement("tr");
           const providers = user.providers.length
               ? user.providers.map((provider) => provider === "google.com" ? "Google" :
                   provider === "password" ? "Email / mật khẩu" : provider).join(", ")
               : "Không xác định";
           [
               user.displayName || "Chưa có tên",
               user.email || "Chưa có email",
               providers,
               user.uid,
               formatUserDate(user.creationTime),
               formatUserDate(user.lastSignInTime),
               user.disabled ? "Đã khóa" : "Đang hoạt động"
           ].forEach((value) => {
               const cell = document.createElement("td");
               cell.textContent = value;
               row.appendChild(cell);
           });
           tbody.appendChild(row);
       });

       const nextPageToken = response.data.nextPageToken;
       if (nextPageToken) {
           loadMore.dataset.pageToken = nextPageToken;
           loadMore.hidden = false;
       }
       const totalShown = tbody.rows.length;
       status.textContent = totalShown
           ? `Đang hiển thị ${totalShown} tài khoản${nextPageToken ? " (có thể tải thêm)." : "."}`
           : "Chưa có tài khoản Firebase nào.";
   } catch (error) {
       console.error("Không thể tải danh sách tài khoản Firebase:", error);
       status.textContent = error.code === "permission-denied"
           ? "Tài khoản hiện tại không có quyền xem danh sách."
           : error.code === "admin-api-not-configured"
               ? "API chưa được cấu hình khóa dịch vụ trong Vercel. Xem ADMIN-SETUP.md."
               : "Không tải được danh sách tài khoản. Kiểm tra kết nối rồi thử lại.";
   } finally {
       refresh.disabled = false;
   }
}

function bindAdminEvents(authApi) {
if (productPage) {
   productPage.addEventListener("click", renderProductTab);
}

if (categoriesPage) {
   categoriesPage.addEventListener("click", renderCategoriesTab);
}

if (offersPage) {
   offersPage.addEventListener("click", renderOffersTab);
}

if (ordersPage) {
   ordersPage.addEventListener("click", renderOrdersTab);
}

if (reviewsPage) {
   reviewsPage.addEventListener("click", renderReviewsTab);
}

if (messagesPage) {
   messagesPage.addEventListener("click", renderMessagesTab);
}

if (revenuePage) {
   revenuePage.addEventListener("click", renderRevenueTab);
}

if (usersPage) {
   usersPage.addEventListener("click", renderUsersTab);
}

if (logOutPage) {
   logOutPage.addEventListener("click", async () => {
       try {
           await authApi.signOut(authApi.auth);
           window.FlowerSafeStorage.remove("loggedUser", { required: true });
           window.FlowerSafeStorage.remove("loggedAdmin");
           window.location.assign("./login.html");
       } catch (error) {
           console.error("Không thể hoàn tất đăng xuất:", error);
           alert("Chưa thể xóa phiên đăng nhập khỏi trình duyệt. Hãy thử lại trước khi rời trang.");
       }
   });
}

if (currentUserRole === "owner") {
   const ownerLink = document.createElement("p");
   ownerLink.id = "owner_page";
   ownerLink.textContent = "Owner · Quản lý quyền";
   ownerLink.tabIndex = 0;
   ownerLink.setAttribute("role", "link");
   ownerLink.addEventListener("click", () => window.location.assign("./owner.html"));
   ownerLink.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") {
           event.preventDefault();
           window.location.assign("./owner.html");
       }
   });
   logOutPage?.parentElement?.insertBefore(ownerLink, logOutPage);
}

main.addEventListener("click", (event) => {
   const selectAllOfferProducts = event.target.closest("[data-offer-select-all]");
   if (selectAllOfferProducts) {
       const productCheckboxes = [...main.querySelectorAll('#add-offer-form input[name="productIds"]')];
       const shouldSelectAll = productCheckboxes.some((checkbox) => !checkbox.checked);
       productCheckboxes.forEach((checkbox) => {
           checkbox.checked = shouldSelectAll;
       });
       return;
   }

   const offerActionButton = event.target.closest("[data-offer-action]");
   if (offerActionButton) {
       updateOffer(offerActionButton.dataset.offerId, offerActionButton.dataset.offerAction);
       return;
   }

   const editCategoryButton = event.target.closest(".edit-category");
   if (editCategoryButton) {
       renameCategory(editCategoryButton.dataset.category);
       return;
   }

   const deleteCategoryButton = event.target.closest(".delete-category");
   if (deleteCategoryButton) {
       deleteCategory(deleteCategoryButton.dataset.category);
       return;
   }

   const detailsButton = event.target.closest(".show-record-details");
   if (detailsButton) {
       const details = [...main.querySelectorAll(".record-details")]
           .find((element) => element.dataset.recordDetails === `${detailsButton.dataset.recordType}:${detailsButton.dataset.recordId}`);
       if (details) {
           details.hidden = !details.hidden;
           detailsButton.setAttribute("aria-expanded", String(!details.hidden));
           detailsButton.textContent = details.hidden ? "Xem chi tiết" : "Ẩn chi tiết";
       }
       return;
   }

   const editProductButton = event.target.closest(".edit-product");
   if (editProductButton) {
       editingProductId = editProductButton.dataset.id;
       renderProductTab();
       document.getElementById("product-title").focus();
       document.getElementById("add-product-form").scrollIntoView({ behavior: "smooth", block: "center" });
       return;
   }

   const deleteProductButton = event.target.closest(".delete-product");
   if (deleteProductButton) {
       deleteProduct(deleteProductButton.dataset.id);
       return;
   }

   const actionButton = event.target.closest("[data-action]");
   if (actionButton?.dataset.action === "restore-catalog") {
       restoreCatalog();
       return;
   }
   if (actionButton?.dataset.action === "clear-search") {
       productSearchTerm = "";
       renderProductTab();
       return;
   }
   if (actionButton?.dataset.action === "cancel-edit") {
       editingProductId = null;
       renderProductTab();
       return;
   }

   const deleteButton = event.target.closest(".delete-record");
   if (deleteButton) {
       deleteAdminRecord(deleteButton.dataset.recordType, deleteButton.dataset.recordId);
       return;
   }

   const completeButton = event.target.closest(".complete-record");
   if (completeButton) {
       setRecordCompletion(completeButton.dataset.recordType, completeButton.dataset.recordId, true);
       return;
   }

   const restoreButton = event.target.closest(".restore-record");
   if (restoreButton) {
       setRecordCompletion(restoreButton.dataset.recordType, restoreButton.dataset.recordId, false);
       return;
   }

   const saveQty = event.target.closest(".save-qty");
   if (saveQty) {
       const id = saveQty.dataset.id;
       const input = [...main.querySelectorAll(".qty-input")].find((element) => element.dataset.id === id);
       if (input) {
           saveProductQuantity(id, input.value);
       }
   }

   const latePayment = event.target.closest(".record-late-payment");
   if (latePayment) {
       recordLateOrderPayment(latePayment.dataset.orderId);
       return;
   }

   const verifyPayment = event.target.closest(".verify-payment");
   if (verifyPayment) {
       verifyOrderPayment(verifyPayment.dataset.orderId);
       return;
   }

   const statusSave = event.target.closest(".status-save");
   if (statusSave) {
       const orderId = statusSave.dataset.orderId;
       const select = [...main.querySelectorAll(".status-select")].find((element) => element.dataset.orderId === orderId);
       const location = [...main.querySelectorAll(".tracking-location")].find((element) => element.dataset.orderId === orderId);
       const estimatedDelivery = [...main.querySelectorAll(".tracking-eta")].find((element) => element.dataset.orderId === orderId);
       if (select && location && estimatedDelivery) {
           updateOrderStatus(orderId, select.value, location.value.trim(), estimatedDelivery.value);
       }
   }

   const replyButton = event.target.closest(".send-reply");
   if (replyButton) {
       const reviewId = replyButton.dataset.reviewId;
       const messageId = replyButton.dataset.messageId;

       if (reviewId) {
           const input = [...main.querySelectorAll(".reply-input[data-review-id]")]
               .find((element) => element.dataset.reviewId === reviewId);
           if (input) updateReviewReply(reviewId, input.value.trim());
       }

       if (messageId) {
           const input = [...main.querySelectorAll(".reply-input[data-message-id]")]
               .find((element) => element.dataset.messageId === messageId);
           if (input) updateMessageReply(messageId, input.value.trim());
       }
   }
});

main.addEventListener("submit", (event) => {
   if (event.target && event.target.id === "product-search-form") {
       event.preventDefault();
       productSearchTerm = new FormData(event.target).get("search") || "";
       renderProductTab();
   }

   if (event.target && event.target.id === "add-product-form") {
       addNewProduct(event);
   }

   if (event.target && event.target.id === "add-category-form") {
       addCategory(event);
   }

   if (event.target && event.target.id === "add-offer-form") {
       addOffer(event);
   }
});
}

// Firestore calls can wait forever when the browser cannot reach Firestore (writes and
// transactions are queued until it is back). Startup steps give up after a while instead.
function withTimeout(promise, label, ms = 15000) {
   let timer;
   return Promise.race([
       promise,
       new Promise((_, reject) => {
           timer = setTimeout(() => reject(new Error(`${label}: quá ${ms / 1000} giây chưa phản hồi (có thể đang mất kết nối Firestore).`)), ms);
       })
   ]).finally(() => clearTimeout(timer));
}

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

// Re-renders a tab with fresh data while keeping what the admin has typed but not saved yet
// (stock boxes, forms, status/location fields, reply drafts), the opened detail cards, the
// focused field and the scroll position.
function rerenderKeepingEdits(render) {
   const isDirty = (field) => field.tagName === "SELECT"
       ? [...field.options].some((option) => option.selected !== option.defaultSelected)
       : field.value !== field.defaultValue;
   const keyOf = (field) => {
       if (field.id) return field.id;
       const recordId = field.dataset.id ?? field.dataset.orderId ?? field.dataset.reviewId ?? field.dataset.messageId;
       return recordId === undefined ? "" : `${field.className}:${recordId}`;
   };
   const edits = new Map();
   main.querySelectorAll("input, select, textarea").forEach((field) => {
       const key = keyOf(field);
       if (key && isDirty(field)) edits.set(key, field.value);
   });
   const focusedKey = document.activeElement && main.contains(document.activeElement) ? keyOf(document.activeElement) : "";
   const openDetails = new Set([...main.querySelectorAll(".record-details:not([hidden])")]
       .map((element) => element.dataset.recordDetails));
   const scrollY = window.scrollY;

   render();

   main.querySelectorAll(".record-details").forEach((details) => {
       if (!openDetails.has(details.dataset.recordDetails)) return;
       details.hidden = false;
       const [type, id] = details.dataset.recordDetails.split(/:(.*)/s);
       const button = [...main.querySelectorAll(".show-record-details")]
           .find((element) => element.dataset.recordType === type && element.dataset.recordId === id);
       if (button) {
           button.setAttribute("aria-expanded", "true");
           button.textContent = "Ẩn chi tiết";
       }
   });
   main.querySelectorAll("input, select, textarea").forEach((field) => {
       const key = keyOf(field);
       if (edits.has(key)) field.value = edits.get(key);
       if (key && key === focusedKey) field.focus({ preventScroll: true });
   });
   window.scrollTo(0, scrollY);
}

function refreshProductTabKeepingEdits() {
   rerenderKeepingEdits(renderProductTab);
}

window.addEventListener("storage", (event) => {
   const activeHeading = main.querySelector(".panel h2");
   if (event.key === "flowerInventory" && activeHeading?.textContent === "Quản lý kho hoa") {
       refreshProductTabKeepingEdits();
   }
});

window.addEventListener("pagehide", () => {
   if (stopOrderSubscription) stopOrderSubscription();
   if (stopPromotionSubscription) stopPromotionSubscription();
   if (stopReviewSubscription) stopReviewSubscription();
   if (stopCategorySubscription) stopCategorySubscription();
   if (stopMessageSubscription) stopMessageSubscription();
});

window.addEventListener("flowerinventorychange", () => {
    const activeHeading = main.querySelector(".panel h2");
    if (activeHeading?.textContent === "Quản lý kho hoa") {
         refreshProductTabKeepingEdits();
    }
});

initializeAdmin();

(() => {
    const main = document.querySelector("main");
    const ordersPage = document.getElementById("orders_page");
    if (!main || !ordersPage) return;

    const addTrackingCard = () => {
        const dashboard = main.querySelector(".summary");
        if (!dashboard || dashboard.querySelector("[data-dashboard-tracking]")) return;

        const orders = getOrders();

        const activeOrders = orders.filter((order) =>
            !["Đã giao", "Đã hủy"].includes(normalizeOrderStatus(order.status))
        ).length;

        const card = document.createElement("button");
        card.type = "button";
        card.className = "summary-card dashboard-tracking-card";
        card.style.font = "inherit";
        card.style.textAlign = "left";
        card.style.cursor = "pointer";
        card.dataset.dashboardTracking = "true";
        card.setAttribute("aria-label", `Theo dõi ${activeOrders} đơn hàng đang xử lý`);
        card.innerHTML = `
            <h3>Theo dõi đơn hàng</h3>
            <div class="value">${activeOrders}</div>
            <small>Đơn hàng đang xử lý · Nhấn để xem chi tiết</small>
        `;
        card.addEventListener("click", () => ordersPage.click());
        dashboard.append(card);
    };

    addTrackingCard();
    new MutationObserver(addTrackingCard).observe(main, { childList: true, subtree: true });
})();
