export const ORDER_STATUSES = Object.freeze([
    "Chờ xác nhận",
    "Đang chuẩn bị",
    "Đang giao",
    "Đã giao",
    "Đã hủy"
]);

const LEGACY_ORDER_STATUSES = {
    "Hoàn thành": "Đã giao",
    "Đặt hàng": "Chờ xác nhận",
    "Đã nhận đơn": "Chờ xác nhận",
    "Đã vận chuyển": "Đang giao",
    "Hoàn thành chuyến": "Đã giao",
    "Giao hàng thất bại": "Đã hủy",
    "Từ chối đơn hàng": "Đã hủy"
};

export const ORDER_FLOW = Object.freeze(ORDER_STATUSES.filter((status) => status !== "Đã hủy"));

export function orderStatusLabel(status) {
    const value = normalizeOrderStatus(status);
    return value === "Đã giao" ? "Hoàn thành" : value;
}

export function getOrderProgress(order) {
    const status = normalizeOrderStatus(order.status);
    const cancelled = status === "Đã hủy";
    const history = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
    const events = history.filter((event) => ORDER_FLOW.includes(normalizeOrderStatus(event.status)));
    const previous = events.at(-1)?.status;
    const index = ORDER_FLOW.indexOf(cancelled ? normalizeOrderStatus(previous) : status);
    return { cancelled, steps: ORDER_FLOW.map((step, position) => ({
        status: step,
        label: orderStatusLabel(step),
        state: cancelled ? (position <= index ? "stopped" : "upcoming")
            : position < index ? "complete" : position === index ? "current" : "upcoming",
        updatedAt: history.findLast((event) => normalizeOrderStatus(event.status) === step)?.updatedAt || ""
    })) };
}

export function normalizeOrderStatus(status) {
    if (ORDER_STATUSES.includes(status)) return status;
    return LEGACY_ORDER_STATUSES[status] || status || ORDER_STATUSES[0];
}
