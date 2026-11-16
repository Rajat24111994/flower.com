import { registerAdminFunctions } from "./admin-state.js";
import { mountReport } from "./admin-report-view.js?v=2";
import { dateKey as reportDateKey, isOrderPaid } from "./admin-analytics.js?v=2";
import { ORDER_STATUSES, normalizeOrderStatus, orderStatusLabel } from "../order/order-status.js?v=2";

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
                   <small>Toàn thời gian · đơn đã giao, đã thanh toán và chưa hoàn tiền</small>
               </div>
               <div class="summary-card">
                   <h3>Giá trị đơn đặt</h3>
                   <div class="value">${moneyFormat(placedOrderValue)}</div>
                   <small>Tất cả đơn, gồm cả đơn chưa hoàn tất</small>
               </div>
           </div>
       </section>
   `;
   const reportHost = document.createElement("div");
   main.querySelector(".dashboard").append(reportHost);
   mountCurrentReport(reportHost, renderDashboard);
}

function mountCurrentReport(container, rerender) {
   if (orderStoreError || FlowerInventory.areProductsLoaded?.() === false) {
       const notice = document.createElement("p");
       notice.className = "empty-state";
       notice.setAttribute("role", "status");
       notice.textContent = "Chưa tải đủ dữ liệu đơn hàng và sản phẩm. Hãy kiểm tra kết nối rồi thử lại.";
       container.replaceChildren(notice);
       return;
   }
   mountReport({ container, orders: getOrders(), products: getProducts(), filters: reportFilters,
       onFilter: (filters) => { reportFilters = filters; rerender(); } });
}

function renderRevenueTab() {
   main.replaceChildren();
   const host = document.createElement("div");
   main.append(host);
   mountCurrentReport(host, renderRevenueTab);
}

// Explain when the browser must rely on the server because Firestore is blocked.

registerAdminFunctions({ renderDashboard, mountCurrentReport, renderRevenueTab });
