import { normalizeOrderStatus, orderStatusLabel, getOrderProgress } from "./order-status.js?v=2";
import { validateFiles, preparePhotos } from "../review/review-images.js?v=1";

let reviewSubmissionInProgress = false;
let reviewPreviewUrls = [];
const reviewPhotosInput = document.getElementById("review-photos");
function clearReviewPhotos(clearInput = true) {
    reviewPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    reviewPreviewUrls = [];
    if (clearInput) reviewPhotosInput.value = "";
    reviewPhotosInput.setCustomValidity("");
    document.getElementById("review-photo-preview").replaceChildren();
    document.getElementById("review-clear-photos").hidden = true;
}
reviewPhotosInput.addEventListener("change", () => {
    const files = [...reviewPhotosInput.files];
    clearReviewPhotos(false);
    try {
        validateFiles(files);
        files.forEach((file, index) => {
            const image = document.createElement("img");
            image.src = URL.createObjectURL(file); reviewPreviewUrls.push(image.src);
            image.alt = `Ảnh đã chọn ${index + 1}`;
            document.getElementById("review-photo-preview").append(image);
        });
        document.getElementById("review-clear-photos").hidden = files.length === 0;
        document.getElementById("review-feedback").textContent = "";
    } catch (error) {
        reviewPhotosInput.setCustomValidity(error.message);
        document.getElementById("review-feedback").textContent = error.message;
        document.getElementById("review-clear-photos").hidden = false;
    }
});
document.getElementById("review-clear-photos").addEventListener("click", () => {
    clearReviewPhotos(); document.getElementById("review-feedback").textContent = "";
});
window.addEventListener("pagehide", clearReviewPhotos);

const searchForm = document.getElementById("tracking-search");
const orderIdInput = document.getElementById("tracking-order-id");
const phoneInput = document.getElementById("tracking-phone");
const message = document.getElementById("tracking-message");
const results = document.getElementById("tracking-results");
const reviewPanel = document.getElementById("review-panel");
const reviewForm = document.getElementById("order-review-form");
const reviewComment = document.getElementById("review-comment");
const reviewFeedback = document.getElementById("review-feedback");
const ratingStars = [...document.querySelectorAll(".rating-star")];
const trackingIntro = document.getElementById("tracking-intro");
const guestIntro = trackingIntro.innerHTML;
const myOrdersSection = document.getElementById("my-orders");
const myOrdersList = document.getElementById("my-orders-list");
const myOrdersTabs = [...document.querySelectorAll(".my-orders-tab")];
const lookupToggle = document.getElementById("tracking-lookup-toggle");
const STATUS_CLASSES = {
    "Chờ xác nhận": "is-pending",
    "Đang chuẩn bị": "is-preparing",
    "Đang giao": "is-shipping",
    "Đã giao": "is-delivered",
    "Đã hủy": "is-cancelled"
};
const ORDER_GROUPS = {
    active: { statuses: ["Chờ xác nhận", "Đang chuẩn bị", "Đang giao"], empty: "Bạn không có đơn hàng nào đang xử lý." },
    done: { statuses: ["Đã giao"], empty: "Bạn chưa có đơn hàng nào đã hoàn thành." },
    cancelled: { statuses: ["Đã hủy"], empty: "Bạn không có đơn hàng nào đã hủy." }
};
let selectedRating = 0;
let currentOrder = null;
let selectedGroup = "active";
let accountOrdersCache = [];
let accountOrdersError = "";
let stopAccountOrderSubscription = null;

function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatDate(value, includeTime = true) {
    if (!value) return "Chưa cập nhật";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Chưa cập nhật";
    const options = includeTime
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium" };
    return new Intl.DateTimeFormat("vi-VN", options).format(date);
}

function readStoredList(key, label) {
    let storedValue;
    try {
        storedValue = window.FlowerSafeStorage.readText(key);
    } catch (error) {
        console.error(`Không thể đọc ${label}:`, error);
        throw new Error(`Không thể đọc ${label}. Vui lòng kiểm tra cài đặt trình duyệt rồi thử lại.`);
    }

    if (storedValue === null) return [];

    let items;
    try {
        items = window.FlowerSafeStorage.readJson(key, {
            fallback: [],
            validate: (value) => Array.isArray(value)
                && value.every((item) => item && typeof item === "object" && !Array.isArray(item)),
            throwOnError: true
        });
    } catch (error) {
        console.error(`Dữ liệu ${label} bị lỗi định dạng:`, error);
        throw new Error(`Dữ liệu ${label} bị lỗi định dạng. Vui lòng liên hệ cửa hàng để được hỗ trợ.`);
    }

    if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
        console.error(`Dữ liệu ${label} không đúng cấu trúc.`);
        throw new Error(`Dữ liệu ${label} không hợp lệ. Vui lòng liên hệ cửa hàng để được hỗ trợ.`);
    }

    return items;
}

function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 5) return phone || "";
    return `${digits.slice(0, 3)}•••${digits.slice(-3)}`;
}

function getOrderHistory(order) {
    const history = Array.isArray(order.trackingHistory)
        ? order.trackingHistory.map((event) => ({
            ...event,
            status: normalizeOrderStatus(event.status || order.status)
        }))
        : [];
    if (!history.length) {
        history.push({
            status: normalizeOrderStatus(order.status),
            location: order.currentLocation || "Đơn hàng đã được tạo",
            estimatedDelivery: order.estimatedDelivery || "",
            updatedAt: order.createdAt || ""
        });
    }
    return history.sort((first, second) => new Date(first.updatedAt || 0) - new Date(second.updatedAt || 0));
}

function renderHistory(order) {
    const progress = getOrderProgress(order);
    const steps = document.getElementById("order-progress");
    steps.replaceChildren();
    progress.steps.forEach((step, index) => {
        const row = makeElement("li", `order-progress-step is-${step.state}`);
        const number = makeElement("span", "order-progress-number", String(index + 1));
        number.setAttribute("aria-hidden", "true");
        row.append(number, makeElement("strong", "", step.label));
        if (step.state === "current") row.setAttribute("aria-current", "step");
        const description = { complete: "Đã qua bước", current: "Trạng thái hiện tại", upcoming: "Chưa đến bước", stopped: "Đơn đã hủy" };
        row.append(makeElement("small", "", description[step.state]));
        if (step.updatedAt) row.append(makeElement("time", "", formatDate(step.updatedAt)));
        steps.append(row);
    });
    document.getElementById("order-cancelled-note").hidden = !progress.cancelled;
    const timeline = document.getElementById("tracking-timeline");
    const history = getOrderHistory(order);
    timeline.replaceChildren();

    history.forEach((event, index) => {
        const item = makeElement("li", `timeline-event${index === history.length - 1 ? " is-current" : ""}`);
        const dot = makeElement("span", "timeline-dot");
        dot.setAttribute("aria-hidden", "true");
        const copy = makeElement("div", "timeline-copy");
        copy.append(makeElement("strong", "", orderStatusLabel(event.status) || "Cập nhật đơn hàng"));
        if (event.location) copy.append(makeElement("p", "", event.location));
        if (event.estimatedDelivery) {
            copy.append(makeElement("p", "", `Dự kiến giao: ${formatDate(event.estimatedDelivery, false)}`));
        }
        const time = makeElement("time", "", formatDate(event.updatedAt));
        if (event.updatedAt) time.dateTime = event.updatedAt;
        copy.append(time);
        item.append(dot, copy);
        timeline.append(item);
    });
}

function renderProducts(items) {
    const container = document.getElementById("tracking-products");
    container.replaceChildren();

    (Array.isArray(items) ? items : []).forEach((product) => {
        const row = makeElement("div", "tracking-product");
        const image = document.createElement("img");
        image.src = product.image || "";
        image.alt = getVietnameseProductName(product.title || "Sản phẩm trong đơn hàng");
        image.width = 96;
        image.height = 96;
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => image.remove(), { once: true });
        row.append(
            image,
            makeElement("span", "tracking-product-name", getVietnameseProductName(product.title || "Sản phẩm")),
            makeElement("span", "tracking-product-quantity", `× ${Math.max(1, Number(product.quantity) || 1)}`)
        );
        const selection = window.FlowerBouquetOptions.summary(product);
        if (selection) row.append(makeElement("span", "tracking-product-options", selection));
        container.append(row);
    });
}

function getStoredReviews() {
    return readStoredList("flowerReviews", "danh sách đánh giá");
}

function setSelectedRating(rating) {
    selectedRating = rating;
    ratingStars.forEach((star) => {
        const value = Number(star.dataset.rating);
        star.classList.toggle("is-selected", value <= selectedRating);
        star.setAttribute("aria-pressed", String(value === selectedRating));
    });
}

function renderReviewPanel(order) {
    if (reviewSubmissionInProgress) return;
    const canReview = order.privacyLimited !== true && normalizeOrderStatus(order.status) === "Đã giao";
    reviewPanel.hidden = !canReview;
    if (!canReview) return;

    let reviews;
    try {
        reviews = getStoredReviews();
    } catch (error) {
        reviewForm.hidden = true;
        reviewFeedback.textContent = error.message;
        return;
    }

    setSelectedRating(0);
    reviewForm.reset();
    clearReviewPhotos();
    document.getElementById("existing-review-photos").replaceChildren();
    reviewForm.hidden = false;
    reviewFeedback.textContent = "";

    showExistingReview(reviews.find((review) => String(review.orderId) === String(order.id)));

    // The review (and the shop's reply) live in Firestore, so other devices see them too.
    const orderId = String(order.id);
    window.FlowerReviewStore.getForOrder(orderId).then((review) => {
        if (review && currentOrder && String(currentOrder.id) === orderId) showExistingReview(review);
    }).catch((error) => console.warn("Không thể tải đánh giá của đơn hàng:", error));
}

function showExistingReview(existingReview) {
    if (existingReview) {
        const expectedOrderId = currentOrder?.id;
        reviewForm.hidden = true;
        const rating = Math.min(5, Math.max(0, Number(existingReview.rating) || 0));
        const stars = "★".repeat(rating);
        const reviewText = `Bạn đã đánh giá đơn hàng này: ${stars}. ${existingReview.comment || ""}`;
        const replyText = existingReview.reply
            ? ` Phản hồi từ Flowerflow: ${existingReview.reply}`
            : "";
        const moderation = { pending: "Đang chờ kiểm duyệt", approved: "Đã hiển thị công khai", hidden: "Đã ẩn bởi kiểm duyệt" };
        reviewFeedback.textContent = `${reviewText} · ${moderation[existingReview.moderationStatus] || "Đang chờ kiểm duyệt"}${existingReview.moderationReason ? ` · Lý do: ${existingReview.moderationReason}` : ""}${replyText}`;
        if (existingReview.photoIds?.length) {
            window.FlowerReviewStore.loadPhotos(existingReview).then((urls) => {
                if (String(currentOrder?.id) !== String(expectedOrderId)) return;
                const images = urls.map((url, index) => { const image = document.createElement("img"); image.src = url; image.alt = `Ảnh đánh giá ${index + 1}`; return image; });
                document.getElementById("existing-review-photos").replaceChildren(...images);
            }).catch(() => { /* The text review remains visible if a photo cannot be loaded. */ });
        }
    }
}

// Same wording as the gift-wrap choices on checkout.html.
const GIFT_WRAP_LABELS = {
    none: "Không yêu cầu thêm",
    pastel: "Giấy gói pastel, ruy băng kem",
    classic: "Giấy kraft, ruy băng đỏ"
};

function renderOrder(order) {
    currentOrder = order;
    document.getElementById("result-order-id").textContent = `#${order.id}`;
    const status = normalizeOrderStatus(order.status);
    const statusElement = document.getElementById("result-status");
    statusElement.textContent = orderStatusLabel(status);
    statusElement.className = "order-status-badge";
    statusElement.classList.add(STATUS_CLASSES[status] || "is-pending");
    document.getElementById("result-location").textContent = order.currentLocation || "Cửa hàng chưa cập nhật vị trí vận chuyển.";
    document.getElementById("result-eta").textContent = formatDate(order.estimatedDelivery, false);
    document.querySelector(".order-details").hidden = order.privacyLimited === true;
    document.querySelector(".tracking-details").classList.toggle("is-privacy-limited", order.privacyLimited === true);
    document.getElementById("tracking-privacy-note").hidden = order.privacyLimited !== true;
    document.getElementById("result-sender").textContent = order.customerName || "Chưa cập nhật";
    document.getElementById("result-sender-phone").textContent = maskPhone(order.phone);
    document.getElementById("result-customer").textContent = order.recipientName || order.customerName || "Chưa cập nhật";
    document.getElementById("result-self-recipient").textContent = order.customerIsRecipient === true ? "Có" : "Không";
    document.getElementById("result-phone").textContent = maskPhone(order.recipientPhone || order.phone);
    document.getElementById("result-address").textContent = order.address || "Chưa cập nhật";
    document.getElementById("result-delivery-zone").textContent = [order.deliveryDistrict, order.deliveryProvince].filter(Boolean).join(", ") || "Chưa cập nhật";
    document.getElementById("result-delivery-date").textContent = formatDate(order.deliveryDate, false);
    document.getElementById("result-delivery-time").textContent = order.deliveryTime || "";
    document.getElementById("result-greeting-card").textContent = order.greetingCard || "";
    document.getElementById("result-anonymous-greeting").textContent = order.anonymousGreetingCard === true ? "Có" : "Không";
    document.getElementById("result-gift-wrap").textContent = GIFT_WRAP_LABELS[order.giftWrap] || order.giftWrap || "Không yêu cầu thêm";
    const formatVnd = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount) || 0);
    document.getElementById("result-shipping-fee").textContent = formatVnd(order.shippingFee);
    document.getElementById("result-total").textContent = formatOrderTotal(order);
    document.getElementById("result-order-note").textContent = order.orderNote || "";
    const vnpayPaymentLabels = {
        chua_thanh_toan: "Chưa thanh toán",
        da_thanh_toan: "Đã thanh toán",
        that_bai: "Thanh toán thất bại"
    };
    document.getElementById("result-payment-status").textContent = order.paymentMethod === "qr"
        ? (["Hết hạn chờ thanh toán", "Đã thanh toán"].includes(order.paymentStatus) ? order.paymentStatus : "Chờ cửa hàng xác minh")
        : order.paymentMethod === "vnpay"
            ? vnpayPaymentLabels[order.paymentStatus] || "Đang chờ VNPay xác nhận"
            : order.paymentStatus || "Thanh toán khi nhận hàng";
    // The note and the shop's reply are only present for the signed-in owner of the order.
    const note = String(order.orderNote || "").trim();
    const reply = String(order.orderNoteReply || "").trim();
    document.getElementById("result-note-row").hidden = !note;
    document.getElementById("result-note").textContent = note;
    document.getElementById("result-reply-row").hidden = !reply;
    document.getElementById("result-reply").textContent = reply;
    renderPaymentInstructions(order);
    renderHistory(order);
    renderProducts(order.items);
    renderReviewPanel(order);
    results.hidden = false;
    message.textContent = "";
    myOrdersList.querySelectorAll(".my-order-card").forEach((card) => {
        card.classList.toggle("is-selected", card.dataset.orderId === String(order.id));
    });
}

function toDateValue(value) {
    if (value && typeof value.toDate === "function") return value.toDate();
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date;
}

// QR orders waiting for the transfer: show the amount, transfer content, QR code and deadline
// again, so the customer can still pay after leaving the checkout page.
function renderPaymentInstructions(order) {
    const panel = document.getElementById("tracking-payment");
    const waiting = order.paymentMethod === "qr" && order.paymentVerified !== true
        && ["Chờ xác nhận", "Đang chuẩn bị"].includes(normalizeOrderStatus(order.status)) && Number(order.total) > 0;
    panel.hidden = !waiting;
    if (!waiting) return;
    const total = Number(order.total);
    const reference = String(order.paymentReference || "");
    document.getElementById("tracking-payment-amount").textContent = formatOrderTotal(order);
    document.getElementById("tracking-payment-reference").textContent = reference || "Mã đơn hàng của bạn";
    const deadline = toDateValue(order.reservationExpiresAt);
    document.getElementById("tracking-payment-deadline").textContent = deadline
        ? deadline.getTime() > Date.now()
            ? `Vui lòng chuyển khoản trước ${deadline.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ngày ${deadline.toLocaleDateString("vi-VN")}.`
            : "Đã quá hạn giữ hàng. Đơn có thể bị hủy bất cứ lúc nào; hãy liên hệ cửa hàng trước khi chuyển khoản."
        : "Vui lòng chuyển khoản sớm để cửa hàng giữ hàng cho bạn.";
    const qrUrl = new URL("https://img.vietqr.io/image/VCB-1063118243-compact2.png");
    qrUrl.searchParams.set("amount", String(total));
    if (reference) qrUrl.searchParams.set("addInfo", reference);
    qrUrl.searchParams.set("accountName", "DO BA THAI");
    document.getElementById("tracking-payment-qr").src = qrUrl.toString();
}

function getLoggedAccount() {
    try {
        const account = window.FlowerSafeStorage.readJson("loggedUser", {
            fallback: null,
            validate: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
        });
        return account && typeof account === "object" ? account : null;
    } catch (error) {
        console.error("Không thể đọc phiên tài khoản:", error);
        return null;
    }
}

function belongsToAccount(order, account) {
    const uid = String(account.uid || "");
    return Boolean(uid) && String(order.uid || "") === uid;
}

function getAccountOrders(account) {
    return accountOrdersCache
        .filter((order) => belongsToAccount(order, account))
        .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
}

function getOrderGroup(order) {
    const status = normalizeOrderStatus(order.status);
    return Object.keys(ORDER_GROUPS).find((group) => ORDER_GROUPS[group].statuses.includes(status)) || "active";
}

function formatOrderTotal(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const total = Number(order.total) || items.reduce(
        (sum, item) => sum + (Number(item.price) || 0) * Math.max(1, Number(item.quantity) || 1), 0);
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(total);
}

function createOrderCard(order) {
    const status = normalizeOrderStatus(order.status);
    const items = Array.isArray(order.items) ? order.items : [];
    const card = makeElement("button", "my-order-card");
    card.type = "button";
    card.dataset.orderId = String(order.id);
    card.classList.toggle("is-selected", currentOrder !== null && String(currentOrder.id) === String(order.id));

    const header = makeElement("div", "my-order-header");
    const title = makeElement("div", "my-order-title");
    title.append(makeElement("strong", "", `Đơn #${order.id}`), makeElement("span", "", formatDate(order.createdAt)));
    const badge = makeElement("span", `order-status-badge ${STATUS_CLASSES[status] || "is-pending"}`, orderStatusLabel(status));
    header.append(title, badge);

    const products = makeElement("div", "my-order-products");
    items.slice(0, 3).forEach((item) => {
        const image = document.createElement("img");
        image.src = item.image || "";
        image.alt = "";
        image.width = 96;
        image.height = 96;
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => image.remove(), { once: true });
        products.append(image);
    });
    const quantity = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
    const firstTitle = getVietnameseProductName(items[0]?.title || "Sản phẩm");
    const summary = items.length > 1 ? `${firstTitle} và ${items.length - 1} sản phẩm khác` : firstTitle;
    products.append(makeElement("span", "my-order-summary", `${summary} · ${quantity} món`));

    const footer = makeElement("div", "my-order-footer");
    footer.append(makeElement("strong", "", formatOrderTotal(order)), makeElement("span", "my-order-link", "Xem chi tiết →"));

    card.append(header, products, footer);
    card.addEventListener("click", () => {
        renderOrder(order);
        results.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return card;
}

function selectOrderGroup(group) {
    selectedGroup = group;
    myOrdersTabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.group === group)));
}

function renderMyOrders() {
    const account = getLoggedAccount();
    myOrdersSection.hidden = !account;
    lookupToggle.hidden = !account;
    searchForm.hidden = Boolean(account) && lookupToggle.getAttribute("aria-expanded") !== "true";
    if (!account) {
        trackingIntro.innerHTML = guestIntro;
        return [];
    }

    trackingIntro.textContent = "Các đơn hàng đặt bằng tài khoản của bạn được hiển thị bên dưới. Chọn một đơn để xem lịch trình giao hoa.";

    if (!account.uid) {
        myOrdersList.replaceChildren(makeElement("p", "my-orders-empty", "Đăng nhập bằng tài khoản Firebase để đồng bộ đơn hàng giữa các thiết bị."));
        return [];
    }
    if (accountOrdersError) {
        myOrdersList.replaceChildren(makeElement("p", "my-orders-empty", accountOrdersError));
        return [];
    }
    const orders = getAccountOrders(account);

    const grouped = { active: [], done: [], cancelled: [] };
    orders.forEach((order) => grouped[getOrderGroup(order)].push(order));
    Object.entries(grouped).forEach(([group, list]) => {
        document.getElementById(`count-${group}`).textContent = String(list.length);
    });
    const cancelledTab = myOrdersTabs.find((tab) => tab.dataset.group === "cancelled");
    cancelledTab.hidden = grouped.cancelled.length === 0;
    if (selectedGroup === "cancelled" && cancelledTab.hidden) selectOrderGroup("active");

    const list = grouped[selectedGroup];
    myOrdersList.replaceChildren(...(list.length
        ? list.map(createOrderCard)
        : [makeElement("p", "my-orders-empty", orders.length
            ? ORDER_GROUPS[selectedGroup].empty
            : "Tài khoản của bạn chưa có đơn hàng nào.")]));
    return orders;
}

async function searchOrder() {
    const orderId = orderIdInput.value.trim().replace(/^#/, "");
    const phone = phoneInput.value.replace(/\D/g, "");
    if (!orderId || phone.length < 8) {
        message.textContent = "Nhập mã đơn hàng và số điện thoại đã dùng khi đặt hàng.";
        return;
    }

    let order = accountOrdersCache.find((item) => String(item.id) === orderId
        && String(item.phone || "").replace(/\D/g, "") === phone);
    try {
        if (!order) order = await window.FlowerOrderStore.getPublicOrder(orderId, phone);
    } catch (error) {
        currentOrder = null;
        results.hidden = true;
        reviewPanel.hidden = true;
        message.textContent = error.code === "order-not-found"
            ? "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại đặt hàng."
            : error.code === "rate-limited"
                ? "Bạn đã tra cứu quá nhiều lần. Vui lòng đợi một chút rồi thử lại."
                : "Chưa thể tra cứu đơn hàng dùng chung. Hãy thử lại sau.";
        return;
    }

    renderOrder(order);
}

ratingStars.forEach((star) => {
    star.addEventListener("click", () => setSelectedRating(Number(star.dataset.rating)));
});

reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (reviewSubmissionInProgress) return;
    const comment = reviewComment.value.trim();

    if (!currentOrder || currentOrder.privacyLimited === true || normalizeOrderStatus(currentOrder.status) !== "Đã giao") {
        reviewFeedback.textContent = "Chỉ có thể đánh giá đơn hàng đã giao.";
        reviewPanel.hidden = true;
        return;
    }
    if (!selectedRating) {
        reviewFeedback.textContent = "Vui lòng chọn số sao đánh giá.";
        return;
    }
    if (!comment) {
        reviewComment.focus();
        reviewFeedback.textContent = "Vui lòng nhập nhận xét trước khi gửi.";
        return;
    }

    let reviews;
    try {
        reviews = getStoredReviews();
    } catch (error) {
        reviewFeedback.textContent = error.message;
        return;
    }

    if (reviews.some((review) => String(review.orderId) === String(currentOrder.id))) {
        renderReviewPanel(currentOrder);
        return;
    }

    const items = Array.isArray(currentOrder.items) ? currentOrder.items : [];
    const review = {
        orderId: currentOrder.id,
        productIds: [...new Set(items.map((item) => item.id).filter((id) => id !== undefined && id !== null).map(String))],
        customerName: currentOrder.customerName || "Khách hàng",
        productName: items.map((item) => getVietnameseProductName(item.title)).filter(Boolean).join(", ") || `Đơn hàng #${currentOrder.id}`,
        rating: selectedRating,
        comment
    };

    const submitButton = reviewForm.querySelector(".review-submit");
    reviewSubmissionInProgress = true;
    const selectedFiles = [...reviewPhotosInput.files];
    reviewForm.querySelectorAll("input, textarea, button").forEach((input) => { input.disabled = true; });
    submitButton.disabled = true;
    reviewFeedback.textContent = "Đang gửi đánh giá...";
    let reviewId;
    try {
        review.photos = await preparePhotos(selectedFiles);
        reviewId = await window.FlowerReviewStore.submit(review);
    } catch (error) {
        console.error("Không thể lưu đánh giá:", error);
        reviewFeedback.textContent = error.message || "Chưa thể gửi đánh giá. Hãy thử lại sau.";
        submitButton.disabled = false;
        reviewSubmissionInProgress = false;
        reviewForm.querySelectorAll("input, textarea, button").forEach((input) => { input.disabled = false; });
        if (error.code === "already-reviewed") {
            try { showExistingReview(await window.FlowerReviewStore.getForOrder(review.orderId)); } catch {}
        }
        return;
    }
    const { photos, ...metadata } = review;
    const savedReview = { ...metadata, id: reviewId, moderationStatus: "pending", verifiedPurchase: true,
        photoIds: photos.map((_, index) => `${reviewId}_${index}`), createdAt: new Date().toISOString(), reply: "" };
    reviews.push(savedReview);
    try {
        window.FlowerSafeStorage.writeJson("flowerReviews", reviews);
    } catch (error) {
        console.warn("Đánh giá đã được đồng bộ công khai nhưng không lưu được bản xem trên thiết bị này:", error);
    }
    reviewSubmissionInProgress = false;
    reviewForm.querySelectorAll("input, textarea, button").forEach((input) => { input.disabled = false; });
    submitButton.disabled = false;
    if (currentOrder) renderReviewPanel(currentOrder);
});

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchOrder();
});

myOrdersTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
        selectOrderGroup(tab.dataset.group);
        renderMyOrders();
    });
});

lookupToggle.addEventListener("click", () => {
    const isOpen = lookupToggle.getAttribute("aria-expanded") !== "true";
    lookupToggle.setAttribute("aria-expanded", String(isOpen));
    searchForm.hidden = !isOpen;
    if (isOpen) orderIdInput.focus();
});

const orderFromUrl = new URLSearchParams(window.location.search).get("id");
if (orderFromUrl) orderIdInput.value = orderFromUrl;
renderMyOrders();

async function startAccountOrderSync() {
    const account = getLoggedAccount();
    if (!account?.uid) return;
    accountOrdersError = "";
    try {
        stopAccountOrderSubscription = await window.FlowerOrderStore.subscribeAccount(account.uid, (orders) => {
            accountOrdersCache = orders;
            accountOrdersError = "";
            const selectedOrderId = currentOrder?.privacyLimited !== true && currentOrder?.id || orderFromUrl;
            const accountOrderFromUrl = selectedOrderId && orders.find((order) => String(order.id) === String(selectedOrderId));
            if (accountOrderFromUrl) {
                selectOrderGroup(getOrderGroup(accountOrderFromUrl));
                renderOrder(accountOrderFromUrl);
            }
            renderMyOrders();
        }, (error) => {
            console.error("Không thể đồng bộ đơn hàng của tài khoản:", error);
            accountOrdersError = "Không thể tải đơn hàng từ hệ thống dùng chung. Kiểm tra kết nối rồi thử lại.";
            renderMyOrders();
        });
    } catch (error) {
        console.error("Không thể đăng ký đồng bộ đơn hàng:", error);
        accountOrdersError = "Không thể tải đơn hàng từ hệ thống dùng chung. Kiểm tra kết nối rồi thử lại.";
        renderMyOrders();
    }
}

void startAccountOrderSync();

window.addEventListener("storage", (event) => {
    if (event.key === "loggedUser" || event.key === null) {
        if (stopAccountOrderSubscription) stopAccountOrderSubscription();
        accountOrdersCache = [];
        renderMyOrders();
        void startAccountOrderSync();
    }
    if (event.key === "flowerReviews" && currentOrder) renderReviewPanel(currentOrder);
});

// store-header.js found that the Firebase session behind "loggedUser" is gone.
window.addEventListener("flowersessionexpired", () => {
    if (stopAccountOrderSubscription) stopAccountOrderSubscription();
    stopAccountOrderSubscription = null;
    accountOrdersCache = [];
    accountOrdersError = "";
    if (currentOrder && currentOrder.privacyLimited !== true) {
        currentOrder = null;
        results.hidden = true;
    }
    renderMyOrders();
});

window.addEventListener("pagehide", () => {
    if (stopAccountOrderSubscription) stopAccountOrderSubscription();
});
