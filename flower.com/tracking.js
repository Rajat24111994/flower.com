import { normalizeOrderStatus } from "./order-status.js";

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
let selectedRating = 0;
let currentOrder = null;

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
        storedValue = localStorage.getItem(key);
    } catch (error) {
        console.error(`Không thể đọc ${label}:`, error);
        throw new Error(`Không thể đọc ${label}. Vui lòng kiểm tra cài đặt trình duyệt rồi thử lại.`);
    }

    if (storedValue === null) return [];

    let items;
    try {
        items = JSON.parse(storedValue);
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
    const timeline = document.getElementById("tracking-timeline");
    const history = getOrderHistory(order);
    timeline.replaceChildren();

    history.forEach((event, index) => {
        const item = makeElement("li", `timeline-event${index === history.length - 1 ? " is-current" : ""}`);
        const dot = makeElement("span", "timeline-dot");
        dot.setAttribute("aria-hidden", "true");
        const copy = makeElement("div", "timeline-copy");
        copy.append(makeElement("strong", "", event.status || "Cập nhật đơn hàng"));
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
        image.alt = product.title || "Sản phẩm trong đơn hàng";
        image.addEventListener("error", () => image.remove(), { once: true });
        row.append(
            image,
            makeElement("span", "tracking-product-name", product.title || "Sản phẩm"),
            makeElement("span", "tracking-product-quantity", `× ${Math.max(1, Number(product.quantity) || 1)}`)
        );
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
    const canReview = normalizeOrderStatus(order.status) === "Đã giao";
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
    reviewForm.hidden = false;
    reviewFeedback.textContent = "";

    const existingReview = reviews.find((review) => String(review.orderId) === String(order.id));
    if (existingReview) {
        reviewForm.hidden = true;
        const rating = Math.min(5, Math.max(0, Number(existingReview.rating) || 0));
        const stars = "★".repeat(rating);
        const reviewText = `Bạn đã đánh giá đơn hàng này: ${stars}. ${existingReview.comment || ""}`;
        const replyText = existingReview.reply
            ? ` Phản hồi từ Flowerflow: ${existingReview.reply}`
            : "";
        reviewFeedback.textContent = `${reviewText}${replyText}`;
    }
}

function renderOrder(order) {
    currentOrder = order;
    document.getElementById("result-order-id").textContent = `#${order.id}`;
    const status = normalizeOrderStatus(order.status);
    const statusElement = document.getElementById("result-status");
    statusElement.textContent = status;
    statusElement.className = "order-status-badge";
    const statusClasses = {
        "Chờ xác nhận": "is-pending",
        "Đang giao": "is-shipping",
        "Đã giao": "is-delivered",
        "Đã hủy": "is-cancelled"
    };
    statusElement.classList.add(statusClasses[status] || "is-pending");
    document.getElementById("result-location").textContent = order.currentLocation || "Cửa hàng chưa cập nhật vị trí vận chuyển.";
    document.getElementById("result-eta").textContent = formatDate(order.estimatedDelivery, false);
    document.getElementById("result-customer").textContent = order.customerName || "Chưa cập nhật";
    document.getElementById("result-phone").textContent = maskPhone(order.phone);
    document.getElementById("result-address").textContent = order.address || "Chưa cập nhật";
    renderHistory(order);
    renderProducts(order.items);
    renderReviewPanel(order);
    results.hidden = false;
    message.textContent = "";
}

function searchOrder() {
    const orderId = orderIdInput.value.trim().replace(/^#/, "");
    const phone = phoneInput.value.replace(/\D/g, "");
    let orders;

    try {
        orders = readStoredList("flowerOrders", "danh sách đơn hàng");
    } catch (error) {
        currentOrder = null;
        results.hidden = true;
        reviewPanel.hidden = true;
        message.textContent = error.message;
        return;
    }

    const order = orders.find((item) => String(item.id) === orderId
        && String(item.phone || "").replace(/\D/g, "") === phone);

    if (!order) {
        currentOrder = null;
        results.hidden = true;
        reviewPanel.hidden = true;
        message.textContent = "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại đặt hàng.";
        return;
    }

    renderOrder(order);
}

ratingStars.forEach((star) => {
    star.addEventListener("click", () => setSelectedRating(Number(star.dataset.rating)));
});

reviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const comment = reviewComment.value.trim();

    if (!currentOrder || normalizeOrderStatus(currentOrder.status) !== "Đã giao") {
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

    const review = {
        id: Date.now(),
        orderId: currentOrder.id,
        customerName: currentOrder.customerName || "Khách hàng",
        phone: currentOrder.phone || "",
        productName: (currentOrder.items || []).map((item) => item.title).filter(Boolean).join(", ") || `Đơn hàng #${currentOrder.id}`,
        rating: selectedRating,
        comment,
        createdAt: new Date().toISOString(),
        reply: ""
    };

    reviews.push(review);
    try {
        localStorage.setItem("flowerReviews", JSON.stringify(reviews));
    } catch (error) {
        console.error("Không thể lưu đánh giá:", error);
        reviewFeedback.textContent = "Không thể lưu đánh giá. Hãy kiểm tra dung lượng trình duyệt rồi thử lại.";
        return;
    }
    renderReviewPanel(currentOrder);
});

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchOrder();
});

const orderFromUrl = new URLSearchParams(window.location.search).get("id");
if (orderFromUrl) orderIdInput.value = orderFromUrl;

window.addEventListener("storage", (event) => {
    if (event.key === "flowerOrders" && orderIdInput.value && phoneInput.value) searchOrder();
    if (event.key === "flowerReviews" && currentOrder) renderReviewPanel(currentOrder);
});
