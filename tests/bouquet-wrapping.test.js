const test = require("node:test");
const assert = require("node:assert/strict");
const wrapping = require("../flower.com/js/catalog/bouquet-wrapping.js");

const tiers = [
  { maxStems: 10, fee: 25000 },
  { maxStems: 25, fee: 40000 },
  { maxStems: 50, fee: 65000 }
];

test("bậc phí phải tăng dần, không vượt 50 cành và phủ đủ đến giới hạn", () => {
  assert.deepEqual(wrapping.normalizeTiers(tiers), tiers);
  assert.equal(wrapping.normalizeTiers([{ maxStems: 10, fee: 25000 }]), null);
  assert.equal(wrapping.normalizeTiers([{ maxStems: 25, fee: 25000 }, { maxStems: 20, fee: 30000 }, { maxStems: 50, fee: 40000 }]), null);
  assert.equal(wrapping.normalizeTiers([{ maxStems: 50, fee: -1 }]), null);
  assert.equal(wrapping.normalizeTiers([{ maxStems: "50", fee: 0 }]), null);
});

test("phí được chọn theo tổng cành của từng bó", () => {
  assert.equal(wrapping.feeForStemCount(tiers, 1), 25000);
  assert.equal(wrapping.feeForStemCount(tiers, 10), 25000);
  assert.equal(wrapping.feeForStemCount(tiers, 11), 40000);
  assert.equal(wrapping.feeForStemCount(tiers, 26), 65000);
  assert.equal(wrapping.feeForStemCount(tiers, 51), null);
});

test("không thu phí giấy gói khi khách yêu cầu không dùng giấy", () => {
  assert.equal(wrapping.feeForDesign(tiers, 5, { wrapStyle: "Bó tròn", paperLayers: 2 }), 25000);
  assert.equal(wrapping.feeForDesign(tiers, 5, { wrapStyle: "Không gói", paperLayers: 2 }), 0);
  assert.equal(wrapping.feeForDesign(tiers, 5, { wrapStyle: "Bó tròn", paperLayers: 0 }), 0);
});
