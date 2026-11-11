// Feature tests: đặt hàng (báo giá, tạo đơn, giữ kho, hết hạn, tra cứu) through the real API.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const h = require("./helpers");

const { Timestamp } = h;
const { FieldValue } = require(require.resolve("firebase-admin/firestore", { paths: [h.ROOT] }));

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

test("đặt bó tùy chỉnh gộp nhiều loại hoa và chốt phí theo tổng số cành", async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
    await h.db().doc("products/1").update({ saleType: "flower", priceUpdatedAt: today });
    await h.db().doc("products/2").update({ saleType: "flower", priceUpdatedAt: today });
    await h.db().doc("metadata/bouquetWrapping").set({
        tiers: [{ maxStems: 3, fee: 25000 }, { maxStems: 50, fee: 40000 }]
    });
    const items = [
        {
            id: "rose-line", productId: "1", customBouquetId: "custom-a", quantity: 3,
            size: "standard", color: "original", cardMessage: "Chúc mừng", personalNote: "Hoa chính, giấy đen"
        },
        {
            id: "tulip-line", productId: "2", customBouquetId: "custom-a", quantity: 2,
            size: "standard", color: "original", cardMessage: "Chúc mừng", personalNote: "Hoa phụ, giấy đen"
        }
    ];
    const placed = await h.placeOrder({ items });

    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.quote.body.totals.wrappingFee, 40000);
    assert.equal(placed.quote.body.totals.total, placed.quote.body.totals.subtotal + 40000);
    const order = (await h.db().doc(`orders/${placed.body.order.id}`).get()).data();
    assert.equal(order.orderType, "custom_bouquet");
    assert.equal(order.wrappingFee, 40000);
    assert.deepEqual(order.customBouquets, [{ id: "custom-a", stemCount: 5, wrappingFee: 40000 }]);
    assert.deepEqual(order.items.map((item) => item.customBouquetId), ["custom-a", "custom-a"]);
    assert.deepEqual(order.items.map((item) => item.personalNote), ["Hoa chính, giấy đen", "Hoa phụ, giấy đen"]);
    assert.deepEqual(order.items.map((item) => item.cardMessage), ["Chúc mừng", "Chúc mừng"]);
    assert.equal(await h.stockOf("1"), 7);
    assert.equal(await h.stockOf("2"), 8);
});

test("lưu yêu cầu thiết kế, cửa hàng báo giá và khách xác nhận trước khi xử lý", async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
    await h.db().doc("products/1").update({ saleType: "flower", priceUpdatedAt: today, colors: ["pink", "white"] });
    await h.db().doc("metadata/bouquetWrapping").set({ tiers: [{ maxStems: 50, fee: 30000 }] });
    const customer = await h.createUser();
    const submitted = await h.callApi("designRequests", {
        body: {
            action: "create",
            customerName: "Khách thiết kế",
            phone: "0908123456",
            address: "1 Lê Lợi",
            deliveryDate: h.deliveryDate(),
            deliveryTime: "11:00–14:00",
            deliveryZoneId: "test-zone",
            stems: [{ productId: "1", quantity: 3, color: "Hồng", role: "main" }],
            design: { arrangement: "Tự nhiên", size: "Vừa", wrapStyle: "Bó tròn", paperColor: "Kem", budget: 500000 },
            deliveryNote: "Gọi trước khi giao"
        },
        token: customer.token
    });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const id = submitted.body.request.id;
    assert.equal(submitted.body.request.status, "Chờ tư vấn");
    assert.equal(submitted.body.request.estimatedTotal, h.catalog.find((item) => item.id === 1).price * 3 + 30000);
    assert.equal(submitted.body.request.accessTokenHash, undefined);
    const loaded = await h.callApi("designRequests", {
        method: "GET",
        query: { id, token: submitted.body.accessToken }
    });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.request.stems[0].stock, 10);

    const admin = await h.createUser("admin");
    const quote = await h.callApi("designRequests", {
        body: { action: "admin-update", id, status: "Chờ khách xác nhận", quotedTotal: 420000, quoteNote: "Có thể thay giấy nếu hết màu kem." },
        token: admin.token
    });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    const accepted = await h.callApi("designRequests", {
        body: { action: "respond", id, accessToken: submitted.body.accessToken, response: "accept" }
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.request.status, "Đang thực hiện");
    assert.equal((await h.db().doc(`designRequests/${id}`).get()).get("history").length, 3);
});

test("giá hoặc mức giảm đổi sau quote thì từ chối tạo đơn theo tổng cũ", async () => {
    const items = [{ id: "1", quantity: 1 }];
    const quote = await h.callApi("orders", {
        body: { action: "quote", items, deliveryZoneId: "test-zone" }
    });
    await h.db().doc("products/1").update({ price: 600000 });

    const changedPrice = await h.placeOrder({
        items,
        overrides: { expectedTotals: quote.body.totals }
    });
    assert.equal(changedPrice.status, 409);
    assert.equal(changedPrice.body.code, "price-changed");
    assert.equal(await h.stockOf("1"), 10);

    await h.setPromotions([{ id: "p20", name: "Giảm 20%", discountPercent: 20, active: true, allProducts: true, productIds: [] }]);
    const promotionQuote = await h.callApi("orders", {
        body: { action: "quote", items, promotionId: "p20", deliveryZoneId: "test-zone" }
    });
    await h.setPromotions([{ id: "p20", name: "Giảm 30%", discountPercent: 30, active: true, allProducts: true, productIds: [] }]);
    const changedPromotion = await h.placeOrder({
        items,
        promotionId: "p20",
        overrides: { expectedTotals: promotionQuote.body.totals }
    });
    assert.equal(changedPromotion.status, 409);
    assert.equal(changedPromotion.body.code, "price-changed");
    assert.equal(await h.stockOf("1"), 10);
});

test("báo giá trả tổng tiền, giá từng sản phẩm và tồn kho", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 2 }] } });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.items[0].price, h.catalog.find((item) => item.id === 1).price);
    assert.equal(quote.body.totals.subtotal, quote.body.items[0].price * 2);
    assert.equal(quote.body.totals.total, quote.body.totals.subtotal);
    assert.equal(quote.body.items[0].stock, 10);
});

test("sản phẩm tạm ẩn không được báo giá hoặc đặt hàng", async () => {
    await h.db().doc("products/1").update({ status: "hidden" });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }] } });
    assert.equal(quote.status, 409);
    assert.equal(quote.body.code, "product-unavailable");
    assert.match(quote.body.error, /tạm ẩn/);

    const result = await h.placeOrder({ items: [{ id: "1", quantity: 1 }] });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "product-unavailable");
    assert.equal(await h.stockOf("1"), 10);
});

test("đặt đơn COD: lưu đơn, trừ kho, trạng thái chờ xác nhận", async () => {
    const result = await h.placeOrder({ items: [{ id: "1", quantity: 3 }] });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const order = (await h.db().doc(`orders/${result.body.order.id}`).get()).data();
    assert.equal(order.status, "Chờ xác nhận");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.inventoryState, "reserved");
    assert.equal(order.total, result.quote.body.totals.total);
    assert.equal(order.shippingFee, 0);
    assert.equal(order.deliveryProvince, "Test Province");
    assert.equal(order.deliveryDistrict, "Test District");
    assert.equal(order.uid, "");
    assert.equal(await h.stockOf("1"), 7);
});

test("gửi lại cùng một yêu cầu đặt hàng không tạo đơn thứ hai", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "2", quantity: 1 }] } });
    const body = {
        customerName: "Khách", phone: "0908123456", address: "1 Lê Lợi", deliveryDate: h.deliveryDate(),
        deliveryTime: "11:00–14:00", deliveryZoneId: "test-zone", paymentMethod: "cod", idempotencyKey: randomUUID(),
        expectedTotals: quote.body.totals, items: [{ id: "2", quantity: 1 }]
    };
    const first = await h.callApi("orders", { body });
    const second = await h.callApi("orders", { body });
    assert.equal(first.status, 201);
    assert.equal(second.body.order.id, first.body.order.id);
    assert.equal((await h.db().collection("orders").get()).size, 1);
    assert.equal(await h.stockOf("2"), 9);
});

test("giá thay đổi sau khi báo giá thì không đặt được đơn", async () => {
    const result = await h.placeOrder({ overrides: { expectedTotals: { subtotal: 1, savings: 0, tax: 0, shippingFee: 0, total: 1 } } });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "price-changed");
    assert.equal(await h.stockOf("1"), 10);
});

test("hai yêu cầu đồng thời cùng mã chỉ lưu một đơn; đổi nội dung bị từ chối", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "2", quantity: 1 }] } });
    const body = {
        customerName: "Khách", phone: "0908123456", address: "1 Lê Lợi", deliveryDate: h.deliveryDate(),
        deliveryTime: "11:00–14:00", deliveryZoneId: "test-zone", paymentMethod: "cod", idempotencyKey: randomUUID(),
        expectedTotals: quote.body.totals, items: [{ id: "2", quantity: 1 }]
    };
    const results = await Promise.all([h.callApi("orders", { body }), h.callApi("orders", { body })]);
    results.forEach((result) => assert.equal(result.status, 201, JSON.stringify(result.body)));
    assert.equal(results[0].body.order.id, results[1].body.order.id);
    assert.equal((await h.db().collection("orders").get()).size, 1);
    assert.equal(await h.stockOf("2"), 9);
    const changed = await h.callApi("orders", { body: { ...body, address: "Địa chỉ khác" } });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.code, "idempotency-conflict");
});

test("hai khách tranh sản phẩm cuối cùng: chỉ một đơn giữ được hàng", async () => {
    await h.db().doc("products/2").update({ quantity: 1 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "2", quantity: 1 }] } });
    const body = {
        customerName: "Khách", phone: "0908123456", address: "1 Lê Lợi", deliveryDate: h.deliveryDate(),
        deliveryTime: "11:00–14:00", deliveryZoneId: "test-zone", paymentMethod: "cod", expectedTotals: quote.body.totals,
        items: [{ id: "2", quantity: 1 }]
    };
    const results = await Promise.all([1, 2].map(() => h.callApi("orders", { body: { ...body, idempotencyKey: randomUUID() } })));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(results.find((result) => result.status === 409).body.code, "insufficient-stock");
    assert.equal(await h.stockOf("2"), 0);
    assert.equal((await h.db().collection("orders").get()).size, 1);
});

test("thiếu hàng: báo rõ sản phẩm nào còn bao nhiêu", async () => {
    await h.db().doc("products/6").update({ quantity: 1 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "6", quantity: 3 }] } });
    assert.equal(quote.status, 409);
    assert.equal(quote.body.code, "insufficient-stock");
    assert.deepEqual(quote.body.items.map(({ id, available }) => ({ id, available })), [{ id: "6", available: 1 }]);
});

test("các cấu hình cùng sản phẩm: giá server, lưu thiệp riêng, trừ và hoàn kho gộp", async () => {
    const items = [
        { id: "line-a", productId: "1", size: "large", color: "pink", cardMessage: "Tặng mẹ", personalNote: "Giấy kraft", quantity: 2 },
        { id: "line-b", productId: "1", size: "premium", color: "white", cardMessage: "Cảm ơn", personalNote: "", quantity: 1 }
    ];
    const result = await h.placeOrder({ items, paymentMethod: "qr" });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const orderRef = h.db().doc(`orders/${result.body.order.id}`);
    const order = (await orderRef.get()).data();
    assert.equal(order.items[0].cardMessage, "Tặng mẹ");
    assert.equal(order.items[1].size, "premium");
    assert.equal(order.items[0].personalNote, "Giấy kraft");
    assert.equal(order.items[0].price, (await h.db().doc("products/1").get()).data().price);
    assert.equal(await h.stockOf("1"), 7);
    await orderRef.update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal(await h.stockOf("1"), 10);
    await h.db().doc("products/1").update({ quantity: 2 });
    const shortage = await h.callApi("orders", { body: { action: "quote", items } });
    assert.equal(shortage.status, 409);
    assert.equal(shortage.body.items.length, 2);
});

test("báo giá mới tự dọn reservation hết hạn dù cron chưa chạy", async () => {
    const placed = await h.placeOrder({ items: [{ id: "3", quantity: 2 }], paymentMethod: "cod" });
    const orderRef = h.db().doc(`orders/${placed.body.order.id}`);
    assert.equal(await h.stockOf("3"), 8);
    await orderRef.update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });

    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "3", quantity: 2 }] } });

    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(await h.stockOf("3"), 10);
    const expired = (await orderRef.get()).data();
    assert.equal(expired.status, "Đã hủy");
    assert.equal(expired.inventoryReserved, false);
    assert.equal(expired.inventoryState, "released");
});

test("ghi chú quá 500 ký tự bị từ chối, không bị cắt", async () => {
    const result = await h.placeOrder({ overrides: { orderNote: "a".repeat(501) } });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "note-too-long");
});

test("sản phẩm chưa đổi giá (còn lưu USD) vẫn được tính đúng bằng VND", async () => {
    await h.db().doc("products/1").update({ price: 73.99 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }] } });
    assert.equal(quote.body.items[0].price, 1920000);
    assert.equal(quote.body.totals.total, 1920000);
});

test("ưu đãi: máy chủ tính giảm giá và lưu vào đơn", async () => {
    await h.setPromotions([{ id: "p20", name: "Giảm 20%", discountPercent: 20, active: true, allProducts: true, productIds: [] }]);
    const result = await h.placeOrder({ items: [{ id: "1", quantity: 2 }], promotionId: "p20" });
    assert.equal(result.status, 201);
    const order = (await h.db().doc(`orders/${result.body.order.id}`).get()).data();
    assert.equal(order.promotionId, "p20");
    assert.ok(order.savings > 0);
    assert.equal(order.total, order.subtotal - order.savings);
    const expired = await h.placeOrder({ promotionId: "khong-co" });
    assert.equal(expired.body.code, "invalid-promotion");
});

test("đơn QR quá 30 phút chưa trả tiền: tự hủy và trả hàng về kho", async () => {
    const result = await h.placeOrder({ items: [{ id: "3", quantity: 2 }], paymentMethod: "qr" });
    const id = result.body.order.id;
    assert.equal(await h.stockOf("3"), 8);
    await h.db().doc(`orders/${id}`).update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const cron = await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal(cron.status, 200);
    assert.equal(cron.body.released, 1);
    const order = (await h.db().doc(`orders/${id}`).get()).data();
    assert.equal(order.status, "Đã hủy");
    assert.equal(order.inventoryState, "released");
    assert.equal(await h.stockOf("3"), 10);
});

test("cleanup xử lý đơn QR legacy thiếu paymentVerified và chỉ hoàn kho một lần", async () => {
    const result = await h.placeOrder({ items: [{ id: "3", quantity: 1 }], paymentMethod: "qr" });
    const orderRef = h.db().doc(`orders/${result.body.order.id}`);
    await orderRef.update({
        paymentVerified: FieldValue.delete(),
        reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000)
    });

    const cleanupResults = await Promise.all([1, 2].map(() => h.callApi("orders", {
        method: "GET",
        query: { action: "expire" },
        headers: { authorization: ["Bearer", process.env.CRON_SECRET].join(" ") }
    })));

    assert.equal(cleanupResults.reduce((sum, cleanup) => sum + cleanup.body.released, 0), 1);
    assert.equal((await orderRef.get()).data().status, "Đã hủy");
    assert.equal(await h.stockOf("3"), 10);
});

test("cleanup không hủy đơn legacy đã thanh toán khi paymentVerified bị thiếu", async () => {
    const result = await h.placeOrder({ paymentMethod: "qr" });
    const orderRef = h.db().doc(`orders/${result.body.order.id}`);
    await orderRef.update({
        paymentVerified: FieldValue.delete(),
        paymentStatus: "Đã thanh toán",
        reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000)
    });

    const cleanup = await h.callApi("orders", {
        method: "GET",
        query: { action: "expire" },
        headers: { authorization: ["Bearer", process.env.CRON_SECRET].join(" ") }
    });

    const order = (await orderRef.get()).data();
    assert.equal(cleanup.body.released, 0);
    assert.equal(order.status, "Chờ xác nhận");
    assert.equal(order.inventoryReserved, true);
    assert.equal(order.reservationExpiresAt, undefined);
    assert.equal(await h.stockOf("1"), 9);
});

test("đơn QR đã xác nhận tiền thì không bị hủy khi hết hạn", async () => {
    const result = await h.placeOrder({ paymentMethod: "qr" });
    const id = result.body.order.id;
    await h.db().doc(`orders/${id}`).update({ paymentVerified: true, reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal((await h.db().doc(`orders/${id}`).get()).data().status, "Chờ xác nhận");
});

test("tra cứu bằng mã đơn và số điện thoại", async () => {
    const result = await h.placeOrder({ paymentMethod: "qr" });
    const id = result.body.order.id;
    const found = await h.callApi("orders", { body: { action: "lookup", id, phone: "0908 123 456" } });
    assert.equal(found.status, 200);
    assert.equal(found.body.order.status, "Chờ xác nhận");
    assert.equal(found.body.order.total, result.quote.body.totals.total);
    const wrongPhone = await h.callApi("orders", { body: { action: "lookup", id, phone: "0999999999" } });
    assert.equal(wrongPhone.status, 404);
});

test("không đặt được nội dung chuyển khoản trùng với đơn của người khác (F42)", async () => {
    const first = await h.placeOrder({ paymentMethod: "qr" });
    const firstReference = (await h.db().doc(`orders/${first.body.order.id}`).get()).data().paymentReference;
    const copy = await h.placeOrder({ paymentMethod: "qr", overrides: { paymentReference: firstReference } });
    assert.equal(copy.status, 201);
    const copyReference = (await h.db().doc(`orders/${copy.body.order.id}`).get()).data().paymentReference;
    assert.notEqual(copyReference, firstReference);
    assert.equal(copy.body.order.paymentReference, copyReference);
});

test("đặt quá 50 sản phẩm một loại: báo rõ giới hạn thay vì 'không hợp lệ' (F46)", async () => {
    await h.db().doc("products/3").update({ quantity: 100 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "3", quantity: 60 }] } });
    assert.equal(quote.status, 400);
    assert.equal(quote.body.code, "quantity-limit");
    assert.match(quote.body.error, /50/);
});
