import { registerAdminFunctions } from "./admin-state.js";
import { ORDER_STATUSES, canTransitionOrderStatus, normalizeOrderStatus, orderStatusLabel } from "../order/order-status.js?v=3";
import { isOrderPaid } from "./admin-analytics.js?v=2";

function renderCompletionAction(type, record) {
   if (type === "reviews") return "";
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
       .map((item) => `${escapeHtml(item.title)} × ${Number(item.quantity) || 0} ${escapeHtml(item.unit || "bó")}`)
       .join(", ") || "Không có sản phẩm";
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>Đơn #${escapeHtml(order.id)} · ${escapeHtml(order.customerName)}</strong>
               <span><b>Loại đơn:</b> ${order.orderType === "custom_bouquet" ? "Bó hoa theo yêu cầu" : "Bó làm sẵn"}</span>
               <span><b>Sản phẩm:</b> ${itemSummary}</span>
               <span><b>Thời gian đặt:</b> ${new Date(order.createdAt).toLocaleString("vi-VN")}</span>
               <span><b>Thanh toán:</b> ${escapeHtml(getPaymentMethodLabel(order))} · ${escapeHtml(getPaymentDisplayStatus(order))}</span>
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
               <span class="status-badge">${escapeHtml(orderStatusLabel(order.status))}</span>
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
                   <span class="field-label">Người nhận</span>
                   <span class="field-value">${escapeHtml(order.recipientName || order.customerName)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Điện thoại người nhận</span>
                   <span class="field-value">${escapeHtml(order.recipientPhone || order.phone)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Ngày và giờ giao</span>
                   <span class="field-value">${escapeHtml(order.deliveryDate || "Chưa chọn")} · ${escapeHtml(order.deliveryTime || "Chưa chọn")}</span>
               </div>
               <div class="field">
                   <span class="field-label">Khu vực giao hàng</span>
                   <span class="field-value">${escapeHtml([order.deliveryDistrict, order.deliveryProvince].filter(Boolean).join(", ") || "Chưa cập nhật")}</span>
               </div>
               <div class="field">
                   <span class="field-label">Phí giao hàng</span>
                   <span class="field-value">${moneyFormat(order.shippingFee || 0)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Phí gói bó hoa</span>
                   <span class="field-value">${moneyFormat(order.wrappingFee || 0)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Ẩn tên trên thiệp</span>
                   <span class="field-value">${order.anonymousGreetingCard === true ? "Có" : "Không"}</span>
               </div>
               <div class="field">
                   <span class="field-label">Phương thức thanh toán</span>
                   <span class="field-value">${escapeHtml(getPaymentMethodLabel(order))}</span>
               </div>
               <div class="field">
                   <span class="field-label">Trạng thái thanh toán</span>
                   <span class="field-value">${escapeHtml(getPaymentDisplayStatus(order))}</span>
               </div>
               <div class="field full-width">
                   <span class="field-label">Địa chỉ</span>
                   <span class="field-value">${escapeHtml(order.address || "Chưa cập nhật")}</span>
               </div>
           </div>

           ${isOrderPaid(order) || order.paymentRefunded === true ? `
               <div class="reply-box compact-box payment-admin-actions">
                   ${order.paymentRefunded === true
                       ? `<p role="status">Đã ghi nhận hoàn ${moneyFormat(order.paymentRefundAmount || order.total)} · ${escapeHtml(order.paymentRefundReference || "Chưa có mã giao dịch")}</p>`
                       : `<button class="secondary-btn record-payment-refund" data-order-id="${escapeHtml(order.id)}" type="button">Ghi nhận đã hoàn tiền</button>`}
                   <button class="secondary-btn payment-audit" data-order-id="${escapeHtml(order.id)}" type="button">Lịch sử đối soát &amp; hoàn tiền</button>
               </div>
           ` : ""}

           ${String(order.greetingCard || "").trim() ? `
               <div class="section-label">Lời chúc trên thiệp</div>
               <div class="detail-block quote-box">${escapeHtml(order.greetingCard)}</div>
           ` : ""}

           ${String(order.orderNote || "").trim() ? `
               <div class="section-label">Lời nhắn của khách</div>
               <div class="detail-block quote-box">${escapeHtml(order.orderNote)}</div>
               ${order.orderNoteReply ? `<div class="reply-banner"><strong>Cửa hàng đã trả lời:</strong> ${escapeHtml(order.orderNoteReply)}</div>` : ""}
           ` : ""}

           <div class="section-label">Sản phẩm trong đơn</div>
           ${(Array.isArray(order.customBouquets) && order.customBouquets.length) ? `
               <div class="detail-block">
                   ${order.customBouquets.map((bouquet) => `<p>Bó tùy chỉnh: ${Number(bouquet.stemCount) || 0} cành · phí gói ${moneyFormat(bouquet.wrappingFee || 0)}</p>`).join("")}
               </div>
           ` : ""}
           <div class="order-product-list">
               ${items.map((item) => {
                   const product = getProductById(item.productId ?? item.id) || {};
                   const image = getSafeImageUrl(item.image || product.image) || "./images/flowerflow-logo.png";
                   return `
                       <div class="product-card">
                           <img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" width="64" height="64" loading="lazy" decoding="async">
                           <div class="product-card-content">
                               <strong>${escapeHtml(item.title)}</strong>
                               <span>${escapeHtml(FlowerBouquetOptions.summary(item))}</span>
                               <span>Số lượng: ${Number(item.quantity) || 0} ${escapeHtml(item.unit || "bó")}</span>
                               <span>Giá: ${moneyFormat(item.price)} / ${escapeHtml(item.unit || "bó")}${item.priceUpdatedAt ? ` · giá ngày ${escapeHtml(item.priceUpdatedAt)}` : ""}</span>
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
                           ${ORDER_STATUSES.filter((status) => canTransitionOrderStatus(order.status, status)).map((status) => `
                               <option value="${status}" ${status === normalizeOrderStatus(order.status) ? "selected" : ""}>${orderStatusLabel(status)}</option>
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
       "Đang chuẩn bị": 1,
       "Đang giao": 2,
       "Đã giao": 3,
       "Đã hủy": 4
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
   else if (main.querySelector(".dashboard")) renderDashboard();
   else if (heading === "Doanh thu & kho hàng") renderRevenueTab();
   else if (main.querySelector(".dashboard") || !heading) renderDashboard();
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
   if (!canTransitionOrderStatus(order.status, status)) {
       alert(`Không thể chuyển đơn từ “${orderStatusLabel(order.status)}” sang “${orderStatusLabel(status)}”. Hãy cập nhật theo đúng thứ tự.`);
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
   const reconciliationReference = window.prompt("Nhập mã giao dịch trên sao kê ngân hàng:");
   if (!reconciliationReference?.trim()) return;
   try {
       await window.FlowerOrderStore.verifyPayment(orderId, {
           amount: Number(order.total),
           reconciliationReference: reconciliationReference.trim()
       });
   } catch (error) {
       console.error("Không thể xác nhận thanh toán:", error);
       alert(error.code ? error.message : "Chưa thể xác nhận thanh toán. Hãy thử lại sau.");
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
   const reconciliationReference = window.prompt("Nhập mã giao dịch trên sao kê ngân hàng:");
   if (!reconciliationReference?.trim()) return;
   try {
       await window.FlowerOrderStore.recordLatePayment(orderId, {
           amount: Number(order.total),
           reconciliationReference: reconciliationReference.trim()
       });
       alert("Đã ghi nhận tiền chuyển trễ. Đơn được đánh dấu cần khôi phục hoặc hoàn tiền.");
   } catch (error) {
       console.error("Không thể ghi nhận thanh toán trễ:", error);
       alert(error.code ? error.message : "Chưa thể ghi nhận thanh toán. Hãy thử lại sau.");
   }
}

async function recordOrderPaymentRefund(orderId) {
   const order = getOrders().find((item) => String(item.id) === String(orderId));
   if (!order || order.paymentRefunded === true) return;
   const confirmed = window.confirm(
       `Chỉ xác nhận sau khi đã chuyển hoàn đầy đủ ${moneyFormat(order.total)} cho đơn #${order.id}. ` +
       "Thao tác này chỉ ghi nhận giao dịch, không tự chuyển tiền."
   );
   if (!confirmed) return;
   const refundReference = window.prompt("Nhập mã giao dịch hoàn tiền trên sao kê:");
   if (!refundReference?.trim()) return;
   try {
       await window.FlowerOrderStore.recordPaymentRefund(orderId, refundReference.trim());
       alert("Đã ghi nhận giao dịch hoàn tiền. Hệ thống không tự chuyển tiền.");
   } catch (error) {
       console.error("Không thể ghi nhận hoàn tiền:", error);
       alert(error.code ? error.message : "Chưa thể ghi nhận hoàn tiền. Hãy thử lại sau.");
   }
}

async function viewOrderPaymentAudit(orderId) {
   try {
       const entries = await window.FlowerOrderStore.getPaymentAudit(orderId);
       if (!entries.length) {
           alert("Chưa có lịch sử đối soát cho đơn này.");
           return;
       }
       const lines = entries.map((entry) => {
           const action = entry.action === "qr-late-payment-recorded" ? "Ghi nhận thanh toán trễ"
               : entry.action === "payment-refunded" ? "Ghi nhận hoàn tiền"
                   : "Xác nhận thanh toán";
           const timestamp = entry.createdAt ? new Date(entry.createdAt).toLocaleString("vi-VN") : "Chưa có thời gian";
           return [
               `${action} · ${timestamp}`,
               `Người xác nhận: ${entry.actorEmail || entry.actorUid}`,
               `Số tiền: ${moneyFormat(entry.amountVnd)}`,
               `Mã giao dịch ngân hàng: ${entry.reconciliationReference}`,
               `Nội dung chuyển khoản: ${entry.paymentReference || "Không có"}`
           ].join("\n");
       });
       alert(lines.join("\n\n"));
   } catch (error) {
       console.error("Không thể tải lịch sử đối soát thanh toán:", error);
       alert(error.code ? error.message : "Chưa thể tải lịch sử đối soát. Hãy thử lại sau.");
   }
}


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

registerAdminFunctions({ renderCompletionAction, renderCompletedSection, renderCompletedOrderSummary, renderActiveOrderSummary, renderOrderSummary, renderOrderCard, escapeHtml, getSafeImageUrl, getStoredImageUrl, toDateInput, renderOrdersTab, refreshOrdersView, updateOrderStatus, verifyOrderPayment, recordLateOrderPayment, recordOrderPaymentRefund, viewOrderPaymentAudit });
