export const ORDER_STATUSES = Object.freeze([
    "Chờ xác nhận",
    "Đang giao",
    "Đã giao",
    "Đã hủy"
]);

const LEGACY_ORDER_STATUSES = {
    "Đặt hàng": "Chờ xác nhận",
    "Đã nhận đơn": "Chờ xác nhận",
    "Đã vận chuyển": "Đang giao",
    "Hoàn thành chuyến": "Đã giao",
    "Giao hàng thất bại": "Đã hủy",
    "Từ chối đơn hàng": "Đã hủy"
};

export function normalizeOrderStatus(status) {
    if (ORDER_STATUSES.includes(status)) return status;
    return LEGACY_ORDER_STATUSES[status] || status || ORDER_STATUSES[0];
}
