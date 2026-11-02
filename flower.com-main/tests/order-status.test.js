// Unit tests: order statuses, including names used by older versions of the site.
const test = require("node:test");
const assert = require("node:assert/strict");

test("trạng thái đơn hàng chuẩn và trạng thái cũ", async () => {
    const { ORDER_STATUSES, normalizeOrderStatus } = await import("../flower.com/order-status.js");
    assert.deepEqual([...ORDER_STATUSES], ["Chờ xác nhận", "Đang giao", "Đã giao", "Đã hủy"]);
    assert.ok(Object.isFrozen(ORDER_STATUSES));
    for (const status of ORDER_STATUSES) assert.equal(normalizeOrderStatus(status), status);
    assert.equal(normalizeOrderStatus("Đặt hàng"), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus("Đã nhận đơn"), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus("Đã vận chuyển"), "Đang giao");
    assert.equal(normalizeOrderStatus("Hoàn thành chuyến"), "Đã giao");
    assert.equal(normalizeOrderStatus("Giao hàng thất bại"), "Đã hủy");
    assert.equal(normalizeOrderStatus("Từ chối đơn hàng"), "Đã hủy");
    assert.equal(normalizeOrderStatus(""), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus(undefined), "Chờ xác nhận");
});
