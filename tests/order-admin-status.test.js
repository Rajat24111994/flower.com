const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("quản trị ghi bước chuẩn bị và hoàn thành kèm lịch sử và kiểm tra xung đột", async () => {
    const { ORDER_STATUSES, normalizeOrderStatus } = await import("../flower.com/js/order/order-status.js");
    const source = fs.readFileSync(path.join(__dirname, "../flower.com/js/admin/admin.js"), "utf8");
    const handler = source.slice(source.indexOf("async function updateOrderStatus("), source.indexOf("async function verifyOrderPayment("));
    const order = { id: "test-order", status: "Chờ xác nhận", paymentMethod: "cod" };
    const calls = [];
    const context = vm.createContext({ ORDER_STATUSES, normalizeOrderStatus, Date,
        getOrders: () => [order], isOrderPaid: () => false, renderOrdersTab() {},
        alert(message) { throw new Error(message); }, console,
        window: { confirm: () => false, FlowerOrderStore: {
            update: async (id, changes, options) => { calls.push({ id, changes, options }); }
        } }
    });
    vm.runInContext(handler, context);
    await vm.runInContext('updateOrderStatus("test-order", "Đang chuẩn bị", "Đang bó hoa", "")', context);
    assert.equal(calls[0].changes.status, "Đang chuẩn bị");
    assert.equal(calls[0].options.expectedStatus, "Chờ xác nhận");
    assert.equal(calls[0].options.newEvent.status, "Đang chuẩn bị");
    assert.equal(calls[0].options.newEvent.location, "Đang bó hoa");
    assert.ok(Date.parse(calls[0].options.newEvent.updatedAt));
    order.status = "Đang giao";
    await vm.runInContext('updateOrderStatus("test-order", "Đã giao", "Đã nhận hoa", "")', context);
    assert.equal(calls[1].changes.status, "Đã giao");
    assert.equal(calls[1].changes.paymentStatus, "Đã thanh toán");
    assert.equal(calls[1].options.expectedStatus, "Đang giao");
    assert.equal(calls[1].options.newEvent.status, "Đã giao");
});
