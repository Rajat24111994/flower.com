const test = require("node:test");
const assert = require("node:assert/strict");
const { internals } = require("../flower.com/api/flower-prices.js");

const { validFlowerId, validPrice, updateFlowerPrice } = internals;

function fakeDatabase(product) {
    const writes = { updates: [], creates: [] };
    const productRef = { collection: "products", id: "rose" };
    const historyRef = { collection: "priceHistory", id: "history-entry" };
    const db = {
        collection(name) {
            return {
                doc(id) {
                    if (id === undefined) return historyRef;
                    assert.equal(name, "products");
                    return { ...productRef, id };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                async get(reference) {
                    assert.equal(reference.collection, "products");
                    return {
                        exists: Boolean(product),
                        data: () => product
                    };
                },
                update(reference, data) { writes.updates.push({ reference, data }); },
                create(reference, data) { writes.creates.push({ reference, data }); }
            });
        }
    };
    return { db, writes };
}

test("mã hoa chỉ nhận ID hợp lệ và giá là số nguyên VND trong giới hạn", () => {
    for (const id of ["1", "red-rose", "flower_02"]) assert.equal(validFlowerId(id), true);
    for (const id of ["", " ", " red", "red ", "a/b", "a\nb"]) assert.equal(validFlowerId(id), false);
    for (const price of [1000, 12000, 1_000_000_000]) assert.equal(validPrice(price), true);
    for (const price of [0, -1, 999, 1000.5, "12000", 1_000_000_001, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(validPrice(price), false);
    }
});

test("đổi giá hoa cập nhật sản phẩm và tạo lịch sử trong cùng transaction", async () => {
    const { db, writes } = fakeDatabase({
        title: "Hoa hồng đỏ",
        saleType: "flower",
        price: 12000
    });
    const result = await updateFlowerPrice(db, { uid: "owner-1", email: "owner@example.test" }, {
        flowerId: "rose",
        price: 15000
    });

    assert.equal(result.changed, true);
    assert.equal(result.flower.price, 15000);
    assert.equal(writes.updates.length, 1);
    assert.equal(writes.updates[0].data.price, 15000);
    assert.equal(writes.updates[0].data.priceUpdatedBy, "owner-1");
    assert.equal(writes.creates.length, 1);
    assert.equal(writes.creates[0].data.flowerId, "rose");
    assert.equal(writes.creates[0].data.oldPrice, 12000);
    assert.equal(writes.creates[0].data.newPrice, 15000);
    assert.equal(writes.creates[0].data.updatedBy, "owner-1");
});

test("lưu cùng mức giá không cập nhật sản phẩm hoặc ghi thêm lịch sử", async () => {
    const { db, writes } = fakeDatabase({
        title: "Hoa hồng đỏ",
        saleType: "flower",
        price: 12000
    });
    const result = await updateFlowerPrice(db, { uid: "owner-1" }, {
        flowerId: "rose",
        price: 12000
    });

    assert.equal(result.changed, false);
    assert.equal(writes.updates.length, 0);
    assert.equal(writes.creates.length, 0);
});

test("giá USD cũ được chuẩn hóa sang VND trước khi ghi lịch sử", async () => {
    const { db, writes } = fakeDatabase({
        title: "Hoa hồng đỏ",
        saleType: "flower",
        price: 73.99
    });
    await updateFlowerPrice(db, { uid: "owner-1" }, { flowerId: "rose", price: 2_000_000 });
    assert.equal(writes.creates[0].data.oldPrice, 1_920_000);
});

test("không cập nhật nếu hoa không tồn tại hoặc dữ liệu không hợp lệ", async () => {
    const missing = fakeDatabase(null);
    assert.equal((await updateFlowerPrice(missing.db, {}, { flowerId: "rose", price: 15000 })).code, "flower-not-found");
    assert.equal((await updateFlowerPrice(missing.db, {}, { flowerId: "rose", price: "15000" })).code, "invalid-argument");
    assert.equal(missing.writes.updates.length, 0);
    assert.equal(missing.writes.creates.length, 0);
});
