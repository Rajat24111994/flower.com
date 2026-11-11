const test = require("node:test");
const assert = require("node:assert/strict");
const { internals } = require("../flower.com/lib/routes/flower-prices.js");

const { validFlowerId, validPrice, updateFlowerPrice } = internals;

function fakeDatabase(product) {
    const writes = { updates: [], creates: [] };
    const productRef = { collection: "products", id: "rose" };
    const historyRef = { collection: "priceHistory", id: "history-entry" };
    const auditRef = { collection: "adminAudit", id: "audit-entry" };
    const db = {
        collection(name) {
            return {
                doc(id) {
                    if (id === undefined) {
                        assert.ok(["priceHistory", "adminAudit"].includes(name));
                        return name === "priceHistory" ? historyRef : auditRef;
                    }
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

test("đổi giá hoa cập nhật sản phẩm, lịch sử giá và audit trong cùng transaction", async () => {
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
    assert.equal(writes.creates.length, 2);
    const history = writes.creates.filter(write => write.reference.collection === "priceHistory");
    const audits = writes.creates.filter(write => write.reference.collection === "adminAudit");
    assert.equal(history.length, 1); assert.equal(audits.length, 1);
    assert.equal(history[0].data.flowerId, "rose");
    assert.equal(history[0].data.oldPrice, 12000);
    assert.equal(history[0].data.newPrice, 15000);
    assert.equal(history[0].data.updatedBy, "owner-1");
    assert.equal(audits[0].data.actorUid, "owner-1");
    assert.equal(audits[0].data.actorEmail, "owner@example.test");
    assert.equal(audits[0].data.action, "flower-price.update");
    assert.equal(audits[0].data.resourceType, "flower");
    assert.equal(audits[0].data.resourceId, "rose");
    assert.deepEqual(audits[0].data.details, { oldPrice: 12000, newPrice: 15000 });
    assert.ok(audits[0].data.createdAt);
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
    assert.equal(writes.creates.find(write => write.reference.collection === "priceHistory").data.oldPrice, 1_920_000);
});

test("không cập nhật nếu hoa không tồn tại hoặc dữ liệu không hợp lệ", async () => {
    const missing = fakeDatabase(null);
    assert.equal((await updateFlowerPrice(missing.db, {}, { flowerId: "rose", price: 15000 })).code, "flower-not-found");
    assert.equal((await updateFlowerPrice(missing.db, {}, { flowerId: "rose", price: "15000" })).code, "invalid-argument");
    assert.equal(missing.writes.updates.length, 0);
    assert.equal(missing.writes.creates.length, 0);
});
