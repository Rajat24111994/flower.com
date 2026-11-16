const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("hủy đơn hoàn kho đúng tổng số lượng và yêu cầu hủy lặp không cộng kho lần nữa", async () => {
    const sourcePath = path.join(__dirname, "../flower.com/js/order/order-store.js");
    const originalSource = fs.readFileSync(sourcePath, "utf8");
    let source = originalSource;
    source = source.replace(
        /  async function getFirebase\(\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  function serializeDocument/,
        "  async function getFirebase() { return mockFirebase; }\n\n  function serializeDocument"
    );
    assert.notEqual(source, originalSource, "test mock must replace Firebase initialization");

    const records = {
        "orders/order-1": {
            status: "Chờ xác nhận", inventoryState: "reserved", inventoryReserved: true,
            items: [
                { id: "rose", productId: "rose", quantity: 2 },
                { id: "rose-premium", productId: "rose", quantity: 1 }
            ]
        },
        "products/rose": { quantity: 4 }
    };
    const firestoreSdk = {
        doc(_db, collection, id) { return { path: `${collection}/${id}` }; },
        async runTransaction(_db, callback) {
            return callback({
                async get(reference) {
                    const value = records[reference.path];
                    return { ref: reference, exists: () => Boolean(value), data: () => value && { ...value } };
                },
                update(reference, changes) {
                    records[reference.path] = { ...records[reference.path], ...changes };
                },
                delete(reference) { delete records[reference.path]; }
            });
        },
        Timestamp: { fromDate: (value) => value },
        deleteField: () => "__delete_field__"
    };
    const mockFirebase = { db: {}, firestoreSdk };
    const window = { FlowerProductSales: require("../flower.com/js/catalog/product-sales.js") };
    const context = vm.createContext({
        window,
        mockFirebase,
        Date,
        console
    });
    vm.runInContext(source, context);

    await context.window.FlowerOrderStore.update("order-1", { status: "Đã hủy" });
    assert.equal(records["products/rose"].quantity, 7);
    assert.equal(records["orders/order-1"].inventoryState, "released");
    assert.equal(records["orders/order-1"].inventoryReserved, false);

    await context.window.FlowerOrderStore.update("order-1", { status: "Đã hủy" });
    assert.equal(records["products/rose"].quantity, 7);
});
