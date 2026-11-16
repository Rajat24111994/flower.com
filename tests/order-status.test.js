// Unit tests: order statuses, including names used by older versions of the site.
const test = require("node:test");
const assert = require("node:assert/strict");

test("trạng thái đơn hàng chuẩn và trạng thái cũ", async () => {
    const { ORDER_STATUSES, normalizeOrderStatus, canTransitionOrderStatus } = await import("../flower.com/js/order/order-status.js");
    assert.deepEqual([...ORDER_STATUSES], ["Chờ xác nhận", "Đang chuẩn bị", "Đang giao", "Đã giao", "Đã hủy"]);
    assert.ok(Object.isFrozen(ORDER_STATUSES));
    for (const status of ORDER_STATUSES) assert.equal(normalizeOrderStatus(status), status);
    assert.equal(normalizeOrderStatus("Đặt hàng"), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus("Đã nhận đơn"), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus("Đã vận chuyển"), "Đang giao");
    assert.equal(normalizeOrderStatus("Hoàn thành chuyến"), "Đã giao");
    assert.equal(normalizeOrderStatus("Hoàn thành"), "Đã giao");
    assert.equal(normalizeOrderStatus("Giao hàng thất bại"), "Đã hủy");
    assert.equal(normalizeOrderStatus("Từ chối đơn hàng"), "Đã hủy");
    assert.equal(normalizeOrderStatus(""), "Chờ xác nhận");
    assert.equal(normalizeOrderStatus(undefined), "Chờ xác nhận");
    assert.equal(canTransitionOrderStatus("Chờ xác nhận", "Đang chuẩn bị"), true);
    assert.equal(canTransitionOrderStatus("Chờ xác nhận", "Đang giao"), false);
    assert.equal(canTransitionOrderStatus("Đang chuẩn bị", "Đang giao"), true);
    assert.equal(canTransitionOrderStatus("Đang chuẩn bị", "Đã giao"), false);
    assert.equal(canTransitionOrderStatus("Đang giao", "Đã giao"), true);
    assert.equal(canTransitionOrderStatus("Đã giao", "Đã hủy"), true);
    assert.equal(canTransitionOrderStatus("Đã hủy", "Chờ xác nhận"), true);
    assert.equal(canTransitionOrderStatus("Đã hủy", "Đang chuẩn bị"), false);
    assert.equal(canTransitionOrderStatus("Đã vận chuyển", "Đã giao"), true);
});

test("tiến độ bốn bước, đơn cũ và đơn hủy không tạo mốc cập nhật giả", async () => {
    const { getOrderProgress, orderStatusLabel } = await import("../flower.com/js/order/order-status.js");
    assert.equal(orderStatusLabel("Đã giao"), "Hoàn thành");
    const order = { status: "Đang chuẩn bị", trackingHistory: [
        { status: "Chờ xác nhận", updatedAt: "2026-11-02T01:00:00Z" },
        { status: "Đang chuẩn bị", updatedAt: "2026-11-02T02:00:00Z" }
    ] };
    const progress = getOrderProgress(order);
    assert.deepEqual(progress.steps.map((step) => step.state), ["complete", "current", "upcoming", "upcoming"]);
    assert.equal(progress.steps[2].updatedAt, "");
    const legacy = getOrderProgress({ status: "Đã giao", trackingHistory: [{ status: "Đã giao", updatedAt: "2026-11-02" }] });
    assert.equal(legacy.steps[3].label, "Hoàn thành");
    assert.equal(legacy.steps[1].updatedAt, "");
    const cancelled = getOrderProgress({ ...order, status: "Đã hủy" });
    assert.equal(cancelled.cancelled, true);
    assert.ok(cancelled.steps.every((step) => step.state !== "current" && step.state !== "complete"));
});
