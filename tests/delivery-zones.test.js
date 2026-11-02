const test = require("node:test");
const assert = require("node:assert/strict");
const { internals } = require("../flower.com/api/delivery-zones.js");

const { validZone, hasDuplicateAreas } = internals;

test("delivery zone validator accepts configured VND fees including the zero default", () => {
    assert.deepEqual(validZone({
        id: "zone-1",
        province: "Tỉnh đã xác nhận",
        district: "Quận đã xác nhận",
        fee: 0,
        enabled: true
    }), {
        id: "zone-1",
        province: "Tỉnh đã xác nhận",
        district: "Quận đã xác nhận",
        fee: 0,
        enabled: true
    });
});

test("delivery zone validator rejects missing names, invalid fees, and malformed IDs", () => {
    const valid = { id: "zone-1", province: "Tỉnh", district: "Quận", fee: 0, enabled: true };
    for (const changes of [
        { id: "../metadata" },
        { province: "" },
        { district: " ".repeat(1) },
        { fee: -1 },
        { fee: 1.5 },
        { fee: "12000" },
        { enabled: "true" }
    ]) {
        assert.equal(validZone({ ...valid, ...changes }), null, JSON.stringify(changes));
    }
});

test("delivery areas are unique regardless of letter case", () => {
    const first = { province: "Thành phố X", district: "Quận 1" };
    assert.equal(hasDuplicateAreas([
        { ...first },
        { province: "thành phố x", district: "quận 1" }
    ]), true);
    assert.equal(hasDuplicateAreas([
        { ...first },
        { province: "Thành phố X", district: "Quận 2" }
    ]), false);
});
