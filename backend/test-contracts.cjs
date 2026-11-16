const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const rules = require("../flower.com/api/orders.js").internals;
const design = require("../flower.com/api/design-requests.js").internals;
const wrapping = require("../flower.com/js/catalog/bouquet-wrapping.js");
const zones = require("../flower.com/api/delivery-zones.js").internals;
const images = require("../flower.com/lib/review-images.js");
const vnpay = require("../flower.com/lib/vnpay.js");
const { toVndPrice } = require("../flower.com/js/catalog/product-store.js");
const cases = [], expected = [];
const functions = {
    quote: rules.validateQuote, checkout: rules.validateCheckout, design: design.parseDesign,
    stems: design.normalizeStems, tiers: wrapping.normalizeTiers, zone: zones.validZone,
    vnd: toVndPrice, image: design.validImage, canonical: vnpay.canonicalQuery,
    photos: input => images.validateReviewPhotos(input)?.map(bytes => bytes.toString("base64")) ?? null,
    schedule: input => rules.deliveryScheduleError(input.date, input.time, new Date(input.now)),
    tracking: input => rules.publicTrackingOrder("fixture", input),
    cart: input => ({ ...rules.priceCart(input.items, input.promotion), wrappingFee: 0, shippingFee: 0 })
};
function add(operation, input) {
    cases.push({ operation, input });
    try { expected.push(functions[operation](input)); }
    catch (error) { expected.push({ code: error.code, error: error.message }); }
}
for (const value of [null, -1, 0, 0.5, 1, 73.99, 999, 999.9, 1000, 1000.5, 1000000000, "25000", "", "abc"]) add("vnd", value);
const quote = { items: [{ id: "1", quantity: 2 }], promotionId: "", deliveryZoneId: "test-zone" };
const checkout = { ...quote, customerName: "Nguyễn Văn A", phone: "0908123456", address: "147 Lê Lợi", deliveryDate: "2099-12-25", deliveryTime: "08:00–11:00", paymentMethod: "cod", idempotencyKey: "12345678-1234-4123-8123-123456789abc", expectedTotals: { subtotal: 500000, savings: 0, tax: 0, shippingFee: 0, total: 500000 } };
add("quote", quote); add("checkout", checkout);
for (const value of [-1, 0, 1, 1.5, 50, 51, "2", null, "abc"]) {
    add("quote", { ...quote, items: [{ id: "1", quantity: value }] });
    add("checkout", { ...checkout, items: [{ id: "1", quantity: value }] });
}
for (const value of ["", "a/b", " ", "a".repeat(129), "rose-line"]) {
    add("quote", { ...quote, items: [{ id: value, productId: "1", quantity: 1, size: "large", color: "pink", cardMessage: "Chúc mừng", personalNote: "Ghi chú" }] });
}
for (const value of ["standard", "large", "premium", "giant", ""]) add("quote", { ...quote, items: [{ id: "1", quantity: 1, size: value }] });
for (const input of [{}, { paperLayers: 0 }, { paperLayers: "0" }, { paperLayers: 6 }, { budget: -1 }, { budget: 1000000001 }, { addons: ["gấu bông nhỏ", "gấu bông nhỏ"] }, { addons: ["other"] }, { excludedFlowers: ["hồng", "hồng", ""] }, { paperColor: "ĐỎ" }, { mainProductId: "x/y" }]) add("design", input);
for (const input of [[], null, [{ productId: "1", quantity: 1, color: "hồng", role: "main" }], [{ productId: "1", quantity: 51, color: "hồng" }], [{ productId: "1", quantity: 1, color: "pink" }]]) add("stems", input);
for (const input of [[], null, [{ maxStems: 50, fee: 0 }], [{ maxStems: 49, fee: 10 }], [{ maxStems: 10, fee: 30000 }, { maxStems: 50, fee: 50000 }], [{ maxStems: 50, fee: "50000" }], [{ maxStems: 50, fee: -1 }]]) add("tiers", input);
for (const fee of [0, 1, -1, 0.5, "100", null, 1000000001]) add("zone", { id: "a", province: " Hồ Chí Minh ", district: "Quận 1", fee, enabled: true });
for (const input of [[], null, ["bad"], ["data:image/jpeg;base64,YWJj"], [1], ["", "", "", ""]]) add("photos", input);
for (const input of [null, "", "data:image/png;base64,abcd", "not-image"]) add("image", input);
for (const date of ["2026-02-29", "2026-11-16", "2026-11-17", "2026-11-15", "invalid"])
    for (const time of ["08:00–11:00", "17:00–20:00", "bad"])
        for (const now of ["2026-11-16T00:59:00Z", "2026-11-16T08:00:00Z"]) add("schedule", { date, time, now });
for (const method of ["qr", "cod", "vnpay"]) for (const status of ["Chờ xác nhận", "Đang chuẩn bị", "Đã hủy"])
    add("tracking", { paymentMethod: method, status, total: 250000, wrappingFee: 0, uid: "private", phone: "private", customerName: "private", address: "private", paymentReference: "FF123", trackingHistory: [{ status, location: "private", estimatedDelivery: "", updatedAt: "2026-11-16T01:00:00.000Z" }] });
add("canonical", { vnp_OrderInfo: "Hoa + ~!*'() tiếng Việt", vnp_Amount: 25000000, vnp_SecureHash: "ignore", ignored: "skip", vnp_Empty: "" });
for (let percent = 1; percent <= 100; percent += 3) add("cart", { items: [{ id: "1", quantity: 3, price: 10001 }, { id: "2", quantity: 2, price: 250001 }], promotion: { discountPercent: percent, productIds: ["1"] } });
const result = spawnSync("dotnet", [path.join(__dirname, "Flower.ContractTests/bin/Debug/net10.0/Flower.ContractTests.dll")], {
    input: JSON.stringify({ cases }), encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024
});
assert.equal(result.status, 0, result.stderr || result.stdout);
const actual = JSON.parse(result.stdout);
let failures = 0;
cases.forEach((test, index) => {
    try { assert.deepEqual(actual[index], JSON.parse(JSON.stringify(expected[index]))); }
    catch { console.error("Contract mismatch:", JSON.stringify(test), "\nJS:", expected[index], "\nC#:", actual[index]); failures++; }
});
assert.equal(failures, 0, `${failures}/${cases.length} contract differences`);
console.log(`${cases.length} JS/C# contract fixtures passed`);
