import { firebaseConfig } from "./firebase-config.js";
import { ORDER_STATUSES, normalizeOrderStatus } from "./order-status.js";
import { createRandomDemoRevenueOrders, getRevenueMetrics } from "./revenue-metrics.js";

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

const STORAGE_KEYS = {
   orders: "flowerOrders",
   reviews: "flowerReviews",
   messages: "flowerMessages",
   categories: "flowerCategories",
   offers: "flowerPromotions",
   demoRevenue: "flowerRevenueDemoOrders"
};

function moneyFormat(value) {
   return new Intl.NumberFormat("vi-VN", {
       style: "currency",
       currency: "VND"
   }).format(Number(value || 0));
}

function getDemoReviews() {
   const now = Date.now();
   return [
       {
          id: 2001,
          customerName: "Nguyễn Thị Lan",
          phone: "0908123456",
          productName: "Vibrant Spring Basket",
          rating: 5,
          comment: "Hoa rất đẹp, gói hàng cẩn thận và đúng hẹn. Tôi rất hài lòng.",
          createdAt: new Date(now - 86400000).toISOString(),
          reply: "Cảm ơn chị Lan đã tin tưởng. Chúng tôi rất vui được phục vụ!"
       },
       {
          id: 2002,
          customerName: "Trần Bảo Anh",
          phone: "0987654321",
          productName: "Rising Star",
          rating: 4,
          comment: "Mẫu hoa đẹp, màu sắc hài hòa, nhưng tôi muốn thêm một chút hương thơm hơn.",
          createdAt: new Date(now - 259200000).toISOString(),
          reply: "Cảm ơn phản hồi của anh/chị. Chúng tôi sẽ ghi nhận và cải thiện trong lần sau."
       }
   ];
}

function getDemoMessages() {
   const now = Date.now();
   return [
       {
          id: 3001,
          customerName: "Phạm Minh Quân",
          phone: "0912345678",
          subject: "Tư vấn sáng tạo hoa",
          message: "Tôi muốn đặt hoa cho sinh nhật bạn gái theo phong cách tối giản, màu hồng và trắng, gói trang trọng.",
          createdAt: new Date(now - 172800000).toISOString(),
          reply: "Chúng tôi sẽ gợi ý mẫu hoa hồng trắng kết hợp xanh lá tươi, phù hợp phong cách tối giản."
       },
       {
          id: 3002,
          customerName: "Lê Hoài Nam",
          phone: "0909988777",
          subject: "Tư vấn thiết kế hoa",
          message: "Có thể thiết kế giỏ hoa theo chủ đề tiệc cưới có thêm nơ và dây ruy băng không?",
          createdAt: new Date(now - 432000000).toISOString(),
          reply: "Có thể, chúng tôi có gói tùy chỉnh theo chủ đề cưới với nơ và dây ruy băng theo ý khách hàng."
       }
   ];
}

async function ensureStorage() {
   await FlowerInventory.initialize();

   const existingOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.orders) || "[]");
   const existingReviews = JSON.parse(localStorage.getItem(STORAGE_KEYS.reviews) || "[]");
   const existingMessages = JSON.parse(localStorage.getItem(STORAGE_KEYS.messages) || "[]");

   const demoOrderIds = new Set(["1001", "1002", "1003"]);
   const demoOrderEmails = new Set([
       "lan.nguyen@gmail.com",
       "quan.pham@gmail.com",
       "baoanh.tran@gmail.com"
   ]);
   const realOrders = existingOrders.filter((order) =>
       !order || !demoOrderIds.has(String(order.id)) || !demoOrderEmails.has(order.email)
   );
   if (realOrders.length !== existingOrders.length) {
       localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(realOrders));
   }

   if (!localStorage.getItem(STORAGE_KEYS.reviews) || !existingReviews.length) {
       localStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(getDemoReviews()));
   }
   if (!localStorage.getItem(STORAGE_KEYS.messages) || !existingMessages.length) {
       localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(getDemoMessages()));
   }
}

function getProducts() {
    return FlowerInventory.readProducts();
}

function getCategories() {
   const storedCategories = JSON.parse(localStorage.getItem(STORAGE_KEYS.categories) || "[]");
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
   localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(normalizedCategories));
}

function getOffers() {
   const offers = JSON.parse(localStorage.getItem(STORAGE_KEYS.offers) || "[]");
   return Array.isArray(offers) ? offers : [];
}

function saveOffers(offers) {
   localStorage.setItem(STORAGE_KEYS.offers, JSON.stringify(offers));
}

function getOrders() {
   return JSON.parse(localStorage.getItem(STORAGE_KEYS.orders) || "[]");
}

function getReviews() {
   return JSON.parse(localStorage.getItem(STORAGE_KEYS.reviews) || "[]");
}

function getMessages() {
   return JSON.parse(localStorage.getItem(STORAGE_KEYS.messages) || "[]");
}

function renderDashboard() {
   const products = getProducts();
   const orders = getOrders();
   const reviews = getReviews();
   const messages = getMessages();
   const totalStock = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
   const { totalRevenue } = getRevenueMetrics(orders, {}, normalizeOrderStatus);

   main.innerHTML = `
       <section class="dashboard">
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
                   <h3>Doanh thu (đã giao)</h3>
                   <div class="value">${moneyFormat(totalRevenue)}</div>
               </div>
           </div>
       </section>
   `;
}

function renderRevenueTab(dateRange = {}) {
   const now = new Date();
   const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
   const dateToInputValue = (date) => {
       const year = date.getFullYear();
       const month = String(date.getMonth() + 1).padStart(2, "0");
       const day = String(date.getDate()).padStart(2, "0");
       return `${year}-${month}-${day}`;
   };
   const defaultStartDate = dateToInputValue(currentMonthStart);
   const defaultEndDate = dateToInputValue(now);
   const startDate = dateRange.startDate || defaultStartDate;
   const endDate = dateRange.endDate || defaultEndDate;
   const products = getProducts();
   const orders = getOrders();
   const demoRevenueOrders = JSON.parse(localStorage.getItem(STORAGE_KEYS.demoRevenue) || "[]");
   if (!Array.isArray(demoRevenueOrders)) {
       throw new Error("Dữ liệu doanh thu demo không hợp lệ.");
   }
   const totalCurrentStock = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
   const metrics = getRevenueMetrics([...orders, ...demoRevenueOrders], { startDate, endDate }, normalizeOrderStatus);
   const demoRevenueIncluded = demoRevenueOrders.some((order) => metrics.orders.includes(order));

   main.innerHTML = `
       <section class="panel">
           <h2>Doanh thu & kho hàng</h2>
           <form id="revenue-filter" class="revenue-filter">
               <label>
                   <span>Từ ngày</span>
                   <input id="revenue-start-date" type="date" value="${startDate}" required>
               </label>
               <label>
                   <span>Đến ngày</span>
                   <input id="revenue-end-date" type="date" value="${endDate}" required>
               </label>
               <button class="primary-btn" type="submit">Áp dụng</button>
               <button id="reset-revenue-filter" class="secondary-btn" type="button">Đặt lại</button>
               <button id="generate-demo-revenue" class="secondary-btn" type="button">Tạo doanh thu demo tháng 11 = 100 triệu</button>
               <button id="clear-demo-revenue" class="secondary-btn" type="button" ${demoRevenueOrders.length ? "" : "hidden"}>Xóa doanh thu demo</button>
               <p id="revenue-filter-error" class="form-error" aria-live="polite"></p>
           </form>
           <p id="demo-revenue-notice" class="demo-revenue-notice" role="status" aria-live="polite">${demoRevenueIncluded
               ? "Báo cáo đang bao gồm doanh thu demo; đây không phải đơn hàng hoặc doanh thu thật."
               : ""}</p>
           <div class="summary revenue-summary">
               <div class="summary-card revenue-card">
                   <h3>Số hoa đã giao</h3>
                   <div class="value">${metrics.totalSoldUnits}</div>
                   <small>Tổng số lượng trong các đơn giao trong khoảng ngày đã chọn</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Tổng doanh thu</h3>
                   <div class="value">${moneyFormat(metrics.totalRevenue)}</div>
                   <small>Chỉ tính đơn giao trong khoảng ngày đã chọn</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Doanh thu / đơn</h3>
                   <div class="value">${moneyFormat(metrics.averagePerOrder)}</div>
                   <small>Trung bình mỗi đơn đã giao</small>
               </div>
               <div class="summary-card revenue-card">
                   <h3>Hoa hiện có</h3>
                   <div class="value">${totalCurrentStock}</div>
                   <small>Tồn kho hiện tại</small>
               </div>
           </div>
       </section>
   `;

   document.getElementById("revenue-filter").addEventListener("submit", (event) => {
       event.preventDefault();
       const selectedStartDate = document.getElementById("revenue-start-date").value;
       const selectedEndDate = document.getElementById("revenue-end-date").value;
       if (selectedStartDate > selectedEndDate) {
           document.getElementById("revenue-filter-error").textContent = "Ngày bắt đầu không được sau ngày kết thúc.";
           return;
       }
       renderRevenueTab({ startDate: selectedStartDate, endDate: selectedEndDate });
   });
   document.getElementById("reset-revenue-filter").addEventListener("click", () => renderRevenueTab());
   document.getElementById("generate-demo-revenue").addEventListener("click", () => {
       const year = new Date().getFullYear();
       const monthRange = {
           startDate: `${year}-11-01`,
           endDate: `${year}-11-30`
       };
       const actualNovemberRevenue = getRevenueMetrics(orders, monthRange, normalizeOrderStatus).totalRevenue;
       const errorMessage = document.getElementById("revenue-filter-error");

       try {
           const demoOrders = createRandomDemoRevenueOrders(100_000_000, actualNovemberRevenue, year);
           localStorage.setItem(STORAGE_KEYS.demoRevenue, JSON.stringify(demoOrders));
           renderRevenueTab(monthRange);
       } catch (error) {
           console.error("Không thể tạo doanh thu demo:", error);
           errorMessage.textContent = error instanceof RangeError
               ? "Doanh thu thật tháng 11 đã vượt 100 triệu nên không thể thêm số demo để tổng còn đúng 100 triệu."
               : "Không thể lưu doanh thu demo trên trình duyệt này.";
       }
   });
   document.getElementById("clear-demo-revenue").addEventListener("click", () => {
       localStorage.removeItem(STORAGE_KEYS.demoRevenue);
       renderRevenueTab({ startDate, endDate });
   });
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
                               <td><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}"></td>
                               <td>
                                   <div><strong>${escapeHtml(item.title)}</strong></div>
                                   <small>${escapeHtml(item.description || "")}</small>
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
                   <input type="text" id="product-title" placeholder="Tên hoa" value="${escapeHtml(editingProduct?.title || "")}" required maxlength="120">
                   <input type="url" id="product-image" placeholder="Link hình ảnh" value="${escapeHtml(editingProduct?.image || "")}" required>
                   <label class="field-label" for="product-category">Phân loại sản phẩm</label>
                   <select id="product-category">
                       <option value="">Chưa phân loại</option>
                       ${categories.map((category) => `<option value="${escapeHtml(category)}" ${editingProduct?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                   </select>
                   <input type="number" id="product-price" placeholder="Giá (VND)" value="${editingProduct ? toVndAmount(editingProduct.price) : ""}" min="1" step="1" required>
                   <input type="number" id="product-quantity" placeholder="Số lượng" value="${editingProduct ? Number(editingProduct.quantity) || 0 : ""}" min="0" step="1" required>
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
               <p class="category-help">Chọn sản phẩm và phần trăm giảm giá. Tiền giảm = giá × số lượng × phần trăm giảm. Nếu một sản phẩm có nhiều ưu đãi đang bật, chỉ ưu đãi cao nhất được áp dụng.</p>
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
                               <span>${escapeHtml(product.title)}</span>
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

function addOffer(event) {
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

   const offers = getOffers();
   const allProductIds = new Set(getProducts().map((product) => String(product.id)));
   const selectedProductIds = new Set(productIds);
   offers.push({
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
   });
   saveOffers(offers);
   renderOffersTab();
}

function updateOffer(offerId, action) {
   const offers = getOffers();
   const offer = offers.find((item) => String(item.id) === String(offerId));
   if (!offer) return;

   if (action === "delete") {
       if (!window.confirm(`Xóa ưu đãi “${offer.name}”?`)) return;
       saveOffers(offers.filter((item) => String(item.id) !== String(offerId)));
   } else {
       saveOffers(offers.map((item) => String(item.id) === String(offerId)
           ? { ...item, active: !item.active }
           : item
       ));
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

function renameCategory(oldCategory) {
   const newCategory = window.prompt("Nhập tên phân loại mới:", oldCategory)?.trim();
   if (!newCategory || newCategory === oldCategory) return;
   if (getCategories().some((category) => category.toLocaleLowerCase("vi") === newCategory.toLocaleLowerCase("vi"))) {
       alert("Phân loại này đã tồn tại.");
       return;
   }

   saveCategories(getCategories().map((category) => category === oldCategory ? newCategory : category));
   FlowerInventory.saveProducts(getProducts().map((product) =>
       product.category === oldCategory ? { ...product, category: newCategory } : product
   ));
   renderCategoriesTab();
}

function deleteCategory(category) {
   const productCount = getProducts().filter((product) => product.category === category).length;
   const message = productCount
       ? `Xóa phân loại “${category}” và bỏ phân loại khỏi ${productCount} sản phẩm?`
       : `Xóa phân loại “${category}”?`;
   if (!window.confirm(message)) return;

   saveCategories(getCategories().filter((existing) => existing !== category));
   FlowerInventory.saveProducts(getProducts().map((product) =>
       product.category === category ? { ...product, category: "" } : product
   ));
   renderCategoriesTab();
}

function getProductById(productId) {
   const products = getProducts();
   return products.find((product) => String(product.id) === String(productId));
}

function renderCompletionAction(type, record) {
   if (record.completedAt) {
       return `<button class="restore-record" data-record-type="${type}" data-record-id="${record.id}" type="button">Khôi phục</button>`;
   }
   return `<button class="complete-record" data-record-type="${type}" data-record-id="${record.id}" type="button">Hoàn thành</button>`;
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
       .map((item) => `${item.title} × ${item.quantity}`)
       .join(", ") || "Không có sản phẩm";
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>Đơn #${order.id} · ${order.customerName}</strong>
               <span><b>Sản phẩm:</b> ${itemSummary}</span>
               <span><b>Thời gian đặt:</b> ${new Date(order.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="orders" data-record-id="${order.id}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="orders:${order.id}" hidden>
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
                       <strong>Đơn #${order.id} - ${order.customerName}</strong>
                   </div>
                   <div class="order-meta">
                       <span>📞 ${order.phone}</span>
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
                   <span class="field-value">${order.customerName}</span>
               </div>
               <div class="field">
                   <span class="field-label">Điện thoại</span>
                   <span class="field-value">${order.phone}</span>
               </div>
               <div class="field full-width">
                   <span class="field-label">Địa chỉ</span>
                   <span class="field-value">${order.address || "Chưa cập nhật"}</span>
               </div>
           </div>

           <div class="section-label">Sản phẩm trong đơn</div>
           <div class="order-product-list">
               ${items.map((item) => {
                   const product = getProductById(item.id) || {};
                   const image = item.image || product.image || "./images/flowerflow-logo.png";
                   return `
                       <div class="product-card">
                           <img src="${image}" alt="${item.title}">
                           <div class="product-card-content">
                               <strong>${item.title}</strong>
                               <span>Số lượng: ${item.quantity}</span>
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
                           <input class="tracking-location" data-order-id="${order.id}" value="${escapeHtml(order.currentLocation || "")}" placeholder="Ví dụ: Đang giao tại Quận 1">
                       </label>
                       <label>
                           Dự kiến giao đến
                           <input class="tracking-eta" data-order-id="${order.id}" type="date" value="${escapeHtml(toDateInput(order.estimatedDelivery))}">
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
                       <select class="status-select" data-order-id="${order.id}">
                           ${ORDER_STATUSES.map((status) => `
                               <option value="${status}" ${status === normalizeOrderStatus(order.status) ? "selected" : ""}>${status}</option>
                           `).join("")}
                       </select>
                       <button class="status-save" data-order-id="${order.id}">Cập nhật trạng thái</button>
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

function toDateInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function renderOrdersTab() {
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
                       <span>📞 ${review.phone}</span>
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
                   <span class="field-value">${escapeHtml(review.productName)}</span>
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
               <textarea class="reply-input" data-review-id="${review.id}" placeholder="Nhập phản hồi cho khách hàng...">${escapeHtml(review.reply || "")}</textarea>
               <button class="send-reply" data-review-id="${review.id}">Gửi phản hồi</button>
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
               <strong>${escapeHtml(review.customerName)} · ${escapeHtml(review.productName)}</strong>
               <span class="rating-value">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</span>
               <span class="record-summary-preview"><b>Đánh giá:</b> ${escapeHtml(review.comment || "Không có nhận xét")}</span>
               <span><b>Thời gian:</b> ${new Date(review.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="reviews" data-record-id="${review.id}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="reviews:${review.id}" hidden>
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
                       <strong>${message.customerName}</strong>
                   </div>
                   <div class="message-meta">
                       <span>📞 ${message.phone}</span>
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
                   <span class="field-value">${message.subject || "Tư vấn đặt hàng"}</span>
               </div>
           </div>

           <div class="section-label">Nội dung khách nhắn</div>
           <div class="detail-block quote-box">${message.message}</div>
           ${message.reply ? `<div class="reply-banner"><strong>Phản hồi của bạn:</strong> ${message.reply}</div>` : ""}

           <div class="reply-box">
               <label class="field-label">Trả lời khách</label>
               <textarea class="reply-input" data-message-id="${message.id}" placeholder="Nhập câu trả lời cho khách hàng...">${message.reply || ""}</textarea>
               <button class="send-reply" data-message-id="${message.id}">Trả lời</button>
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
               <strong>${message.customerName} · ${message.subject || "Tư vấn đặt hàng"}</strong>
               <span class="record-summary-preview"><b>Nội dung:</b> ${message.message}</span>
               <span><b>Thời gian:</b> ${new Date(message.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="messages" data-record-id="${message.id}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="messages:${message.id}" hidden>
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

function saveProductQuantity(id, quantity) {
   const products = getProducts();
   const nextProducts = products.map((item) => {
       if (String(item.id) === String(id)) {
           return { ...item, quantity: Number(quantity || 0) };
       }
       return item;
   });
    FlowerInventory.saveProducts(nextProducts);
   renderProductTab();
}

function addNewProduct(event) {
   event.preventDefault();
   const title = document.getElementById("product-title").value.trim();
   const image = document.getElementById("product-image").value.trim();
    const priceInVnd = Number(document.getElementById("product-price").value);
   const quantity = Number(document.getElementById("product-quantity").value);
   const description = document.getElementById("product-description").value.trim();
   const category = document.getElementById("product-category").value;

    if (!title || !image || !description || !Number.isFinite(priceInVnd) || priceInVnd < 1 || !Number.isFinite(quantity) || quantity < 0) {
       alert("Vui lòng nhập đầy đủ thông tin.");
       return;
   }

   const products = getProducts();
    const productData = { title, image, price: usdFromVnd(priceInVnd), quantity, description, category };
   const isEditing = editingProductId !== null;
   const nextProducts = isEditing
       ? products.map((item) => String(item.id) === String(editingProductId) ? { ...item, ...productData } : item)
       : [...products, { id: Date.now(), ...productData }];

    FlowerInventory.saveProducts(nextProducts);
   editingProductId = null;
   alert(isEditing ? "Cập nhật sản phẩm thành công!" : "Thêm sản phẩm thành công!");
   renderProductTab();
}

function deleteProduct(id) {
   const product = getProductById(id);
   if (!product || !window.confirm(`Bạn có chắc muốn xóa “${product.title}”?`)) return;

   const products = getProducts().filter((item) => String(item.id) !== String(id));
    FlowerInventory.saveProducts(products);
   if (String(editingProductId) === String(id)) editingProductId = null;
   renderProductTab();
}

function updateOrderStatus(orderId, status, location, estimatedDelivery) {
    if (!ORDER_STATUSES.includes(status)) {
        alert("Trạng thái đơn hàng không hợp lệ.");
        return;
    }
    if (status === "Đang giao" && (!location || !estimatedDelivery)) {
        alert("Vui lòng nhập vị trí hiện tại và ngày dự kiến giao hàng.");
        return;
    }

    const orders = getOrders();
   const updatedAt = new Date().toISOString();
   const nextOrders = orders.map((order) => {
       if (String(order.id) !== String(orderId)) return order;

       const trackingHistory = Array.isArray(order.trackingHistory) && order.trackingHistory.length
           ? order.trackingHistory
           : [{
               status: normalizeOrderStatus(order.status),
               location: order.currentLocation || "Đơn hàng đã được tạo",
               estimatedDelivery: order.estimatedDelivery || "",
               updatedAt: order.createdAt || updatedAt
           }];
       const hasChanges = order.status !== status
           || (order.currentLocation || "") !== location
           || (order.estimatedDelivery || "") !== estimatedDelivery;
       if (!hasChanges) return order;

       return {
           ...order,
           status,
           currentLocation: location,
           estimatedDelivery,
           trackingUpdatedAt: updatedAt,
           trackingHistory: [...trackingHistory, { status, location, estimatedDelivery, updatedAt }]
       };
   });
   localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(nextOrders));
   renderOrdersTab();
}

function updateReviewReply(reviewId, reply) {
   const reviews = getReviews();
   const nextReviews = reviews.map((review) => {
       if (String(review.id) === String(reviewId)) {
           return { ...review, reply };
       }
       return review;
   });
   localStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(nextReviews));
   renderReviewsTab();
}

function updateMessageReply(messageId, reply) {
   const messages = getMessages();
   const nextMessages = messages.map((message) => {
       if (String(message.id) === String(messageId)) {
           return { ...message, reply };
       }
       return message;
   });
   localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(nextMessages));
   renderMessagesTab();
}

function deleteAdminRecord(type, id) {
   const records = {
       orders: { key: STORAGE_KEYS.orders, label: "đơn hàng", render: renderOrdersTab },
       reviews: { key: STORAGE_KEYS.reviews, label: "đánh giá", render: renderReviewsTab },
       messages: { key: STORAGE_KEYS.messages, label: "phản hồi", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể xóa mục admin không hợp lệ:", type);
       return;
   }

   if (!window.confirm(`Bạn có chắc muốn xóa ${record.label} này không?`)) return;

   const savedRecords = JSON.parse(localStorage.getItem(record.key) || "[]");
   const remainingRecords = savedRecords.filter((item) => String(item.id) !== String(id));
   if (remainingRecords.length === savedRecords.length) {
       console.error(`Không tìm thấy ${record.label} cần xóa:`, id);
       return;
   }

   localStorage.setItem(record.key, JSON.stringify(remainingRecords));
   record.render();
}

function setRecordCompletion(type, id, completed) {
   const records = {
       orders: { key: STORAGE_KEYS.orders, label: "đơn hàng", render: renderOrdersTab },
       reviews: { key: STORAGE_KEYS.reviews, label: "đánh giá", render: renderReviewsTab },
       messages: { key: STORAGE_KEYS.messages, label: "phản hồi", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể cập nhật mục hoàn thành không hợp lệ:", type);
       return;
   }

   const savedRecords = JSON.parse(localStorage.getItem(record.key) || "[]");
   let found = false;
   const updatedRecords = savedRecords.map((item) => {
       if (String(item.id) !== String(id)) return item;
       found = true;
       if (completed) return { ...item, completedAt: new Date().toISOString() };
       const { completedAt, ...restoredItem } = item;
       return restoredItem;
   });
   if (!found) {
       console.error(`Không tìm thấy ${record.label} cần cập nhật:`, id);
       return;
   }

   localStorage.setItem(record.key, JSON.stringify(updatedRecords));
   record.render();
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
       localStorage.removeItem("loggedUser");
       localStorage.removeItem("loggedAdmin");
       await authApi.signOut(authApi.auth);
       window.location.assign("./login.html");
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
       const input = document.querySelector(`.qty-input[data-id="${id}"]`);
       if (input) {
           saveProductQuantity(id, input.value);
       }
   }

   const statusSave = event.target.closest(".status-save");
   if (statusSave) {
       const orderId = statusSave.dataset.orderId;
       const select = document.querySelector(`.status-select[data-order-id="${orderId}"]`);
       const location = document.querySelector(`.tracking-location[data-order-id="${orderId}"]`);
       const estimatedDelivery = document.querySelector(`.tracking-eta[data-order-id="${orderId}"]`);
       if (select && location && estimatedDelivery) {
           updateOrderStatus(orderId, select.value, location.value.trim(), estimatedDelivery.value);
       }
   }

   const replyButton = event.target.closest(".send-reply");
   if (replyButton) {
       const reviewId = replyButton.dataset.reviewId;
       const messageId = replyButton.dataset.messageId;

       if (reviewId) {
           const input = document.querySelector(`.reply-input[data-review-id="${reviewId}"]`);
           if (input) updateReviewReply(reviewId, input.value.trim());
       }

       if (messageId) {
           const input = document.querySelector(`.reply-input[data-message-id="${messageId}"]`);
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
           localStorage.removeItem("loggedUser");
           localStorage.removeItem("loggedAdmin");
           window.location.replace("./login.html");
           return;
       }

       currentUserRole = token.claims.role === "owner" ? "owner" : "admin";
       const storedAccount = JSON.parse(localStorage.getItem("loggedUser") || "{}");
       localStorage.setItem("loggedUser", JSON.stringify({
           ...storedAccount,
           uid: currentUser.uid,
           email: currentUser.email || "",
           role: currentUserRole
       }));

       bindAdminEvents({ auth, signOut: authSdk.signOut });
    await ensureStorage();
       renderDashboard();
   } catch (error) {
       console.error("Không thể xác thực trang quản trị:", error);
       main.textContent = "Không thể xác thực quyền quản trị. Kiểm tra cấu hình Firebase rồi tải lại trang.";
   }
}

window.addEventListener("storage", (event) => {
   const activeHeading = main.querySelector(".panel h2");
   if (event.key === "flowerInventory" && activeHeading?.textContent === "Quản lý kho hoa") {
       renderProductTab();
   }
   if (event.key === STORAGE_KEYS.orders && activeHeading?.textContent === "Quản lý đơn hàng") {
       renderOrdersTab();
   }
   if (event.key === STORAGE_KEYS.reviews && activeHeading?.textContent === "Đánh giá khách hàng") {
       renderReviewsTab();
   }
});

window.addEventListener("flowerinventorychange", () => {
    const activeHeading = main.querySelector(".panel h2");
    if (activeHeading?.textContent === "Quản lý kho hoa") {
         renderProductTab();
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

        let orders = [];
        try {
            orders = JSON.parse(localStorage.getItem("flowerOrders") || "[]");
        } catch {
            orders = [];
        }

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
