const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

const flower = {
    id: "red-rose",
    title: "Hoa hồng đỏ",
    image: "./images/rose.webp",
    unit: "cành",
    saleType: "flower",
    status: "active",
    price: 12000,
    priceUpdatedAt: "2026-11-01",
    quantity: 20
};

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.db().doc("products/red-rose").set(flower);
});

test("chỉ Owner truy cập được danh sách, cập nhật giá và lịch sử", async () => {
    const admin = await h.createUser("admin");
    const customer = await h.createUser();
    const owner = await h.createUser("owner");

    assert.equal((await h.callApi("flowerPrices", { method: "GET" })).status, 401);
    for (const user of [admin, customer]) {
        assert.equal((await h.callApi("flowerPrices", { method: "GET", token: user.token })).status, 403);
        assert.equal((await h.callApi("flowerPrices", {
            method: "GET", query: { flowerId: "red-rose" }, token: user.token
        })).status, 403);
        assert.equal((await h.callApi("flowerPrices", {
            method: "PATCH", token: user.token, body: { flowerId: "red-rose", price: 15000 }
        })).status, 403);
    }

    const list = await h.callApi("flowerPrices", { method: "GET", token: owner.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.flowers.map(({ flowerId, name, price }) => ({ flowerId, name, price })), [
        { flowerId: "red-rose", name: "Hoa hồng đỏ", price: 12000 }
    ]);

    const oldOrder = { items: [{ productId: "red-rose", price: 12000, quantity: 2 }], total: 24000 };
    await h.db().doc("orders/price-snapshot").set(oldOrder);
    const updated = await h.callApi("flowerPrices", {
        method: "PATCH", token: owner.token, body: { flowerId: "red-rose", price: 15000 }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.changed, true);
    assert.equal(updated.body.flower.price, 15000);

    const stored = (await h.db().doc("products/red-rose").get()).data();
    assert.equal(stored.price, 15000);
    assert.equal(stored.priceUpdatedBy, owner.uid);
    assert.ok(stored.priceChangedAt.toDate() instanceof Date);
    assert.deepEqual((await h.db().doc("orders/price-snapshot").get()).data(), oldOrder);

    const updatedAgain = await h.callApi("flowerPrices", {
        method: "PATCH", token: owner.token, body: { flowerId: "red-rose", price: 18000 }
    });
    assert.equal(updatedAgain.status, 200);
    assert.equal(updatedAgain.body.changed, true);

    const history = await h.callApi("flowerPrices", {
        method: "GET", query: { flowerId: "red-rose" }, token: owner.token
    });
    assert.equal(history.status, 200);
    assert.equal(history.body.history.length, 2);
    assert.equal(history.body.history[0].oldPrice, 15000);
    assert.equal(history.body.history[0].newPrice, 18000);
    assert.equal(history.body.history[0].updatedBy, owner.email);
    assert.equal(history.body.history[1].oldPrice, 12000);
    assert.equal(history.body.history[1].newPrice, 15000);

    const timestampBeforeUnchanged = (await h.db().doc("products/red-rose").get())
        .data().priceChangedAt.toDate().toISOString();
    const unchanged = await h.callApi("flowerPrices", {
        method: "PATCH", token: owner.token, body: { flowerId: "red-rose", price: 18000 }
    });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.changed, false);
    assert.equal((await h.db().collection("priceHistory").get()).size, 2);
    assert.equal((await h.db().doc("products/red-rose").get()).data().priceChangedAt.toDate().toISOString(), timestampBeforeUnchanged);
});

test("API từ chối giá sai, mã hoa không tồn tại và sản phẩm không phải hoa nguyên liệu", async () => {
    const owner = await h.createUser("owner");
    for (const price of ["15000", -1, 0, 1000.5, 1_000_000_001, null]) {
        const result = await h.callApi("flowerPrices", {
            method: "PATCH", token: owner.token, body: { flowerId: "red-rose", price }
        });
        assert.equal(result.status, 400, String(price));
    }
    assert.equal((await h.callApi("flowerPrices", {
        method: "PATCH", token: owner.token, body: { flowerId: "missing", price: 15000 }
    })).status, 404);
    assert.equal((await h.callApi("flowerPrices", {
        method: "GET", query: { flowerId: "missing" }, token: owner.token
    })).status, 404);
    assert.equal((await h.db().collection("priceHistory").get()).size, 0);
    assert.equal((await h.db().doc("products/red-rose").get()).data().price, 12000);
});
