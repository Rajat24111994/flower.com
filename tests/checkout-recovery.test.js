const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function review(storage, store) {
  const elements = new Map();
  const element = () => ({ textContent: "", disabled: false, hidden: false,
    classList: { toggle() {} }, append() {}, addEventListener() {} });
  const context = vm.createContext({
    FlowerBouquetOptions: require("../flower.com/js/catalog/bouquet-options.js"),
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelector() { return this.getElementById("confirm"); },
      createElement: element
    },
    FlowerSafeStorage: {
      readJson: (key, options) => {
        const values = options.storage === "session" ? storage.sessionStorage : storage;
        return values[key] ?? options.fallback;
      },
      writeJson: (key, value, options = {}) => {
        const values = options.storage === "session" ? storage.sessionStorage : storage;
        values[key] = JSON.parse(JSON.stringify(value));
      },
      remove: (key, options = {}) => {
        const values = options.storage === "session" ? storage.sessionStorage : storage;
        delete values[key];
        return true;
      }
    },
    window: { FlowerOrderStore: store, location: { assign() {} } },
    alert() {}, console: { error() {} },
    formatVnd: String,
  });
  const html = fs.readFileSync(path.join(__dirname, "../flower.com/placeorder.html"), "utf8");
  vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], context);
  return { context, elements };
}
const totals = { subtotal: 250000, savings: 0, tax: 0, shippingFee: 0, total: 250000 };
function storage() {
  return { sessionStorage: { flowerCheckout: {
    customerName: "Khách", phone: "0908123456", address: "1 Lê Lợi",
    deliveryDate: "2099-01-01", deliveryTime: "08:00–11:00",
    deliveryZoneId: "zone-one", paymentMethod: "cod",
    idempotencyKey: "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b", quotedTotals: totals
  } }, cart: [{ id: "1", quantity: 1, price: 10 }] };
}
const flush = () => new Promise(setImmediate);

test("mất phản hồi sau khi lưu: tải lại gửi đúng yêu cầu, không báo giá lại phần kho đã giữ", async () => {
  const data = storage();
  const attempts = [];
  const store = {
    quote: async () => ({ items: [], totals, deliveryZone: { id: "zone-one" } }),
    create: async (order, expectedTotals) => {
      attempts.push(JSON.stringify({ order, expectedTotals }));
      if (attempts.length === 1) throw new Error("connection lost");
      return "saved-order";
    }
  };
  const first = review(data, store);
  await flush();
  await vm.runInContext("saveOrderToAdmin()", first.context);
  assert.ok(data.sessionStorage.flowerPendingOrder);
  data.cart[0].quantity = 5; // another tab changed the cart after the uncertain submission
  store.quote = async () => { throw new Error("must not quote reserved stock again"); };
  const second = review(data, store);
  await flush();
  assert.equal(second.elements.get("confirm").disabled, false);
  assert.match(second.elements.get("order-review-totals").textContent, /0 · Tổng thanh toán: 250000/);
  await vm.runInContext("saveOrderToAdmin()", second.context);
  assert.equal(attempts[1], attempts[0]);
  assert.equal(second.context.window.location.href, "./tracking.html?id=saved-order");
  assert.equal(data.sessionStorage.flowerPendingOrder, undefined);
  assert.equal(data.cart, undefined);
});

test("lỗi mạng báo giá có thể thử lại; hết hàng khi xác nhận giữ nguyên giỏ và chặn gửi lại", async () => {
  const data = storage();
  let offline = true;
  const page = review(data, {
    quote: async () => { if (offline) throw new Error("offline"); return { items: [], totals, deliveryZone: { id: "zone-one" } }; },
    create: async () => { const error = new Error("Hết hàng"); error.code = "insufficient-stock"; throw error; }
  });
  await flush();
  assert.equal(page.elements.get("retry-quote").hidden, false);
  assert.equal(page.elements.get("confirm").disabled, true);
  offline = false;
  await vm.runInContext("verifyOrderBeforeConfirmation()", page.context);
  assert.equal(page.elements.get("confirm").disabled, false);
  await vm.runInContext("saveOrderToAdmin()", page.context);
  assert.equal(page.elements.get("confirm").disabled, true);
  assert.equal(data.cart.length, 1);
  assert.equal(data.sessionStorage.flowerPendingOrder, undefined);
});

test("bấm xác nhận liên tiếp chỉ gửi một yêu cầu", async () => {
  let finish;
  let calls = 0;
  const page = review(storage(), {
    quote: async () => ({ items: [], totals, deliveryZone: { id: "zone-one" } }),
    create: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); }
  });
  await flush();
  const submission = vm.runInContext("saveOrderToAdmin()", page.context);
  await vm.runInContext("saveOrderToAdmin()", page.context);
  assert.equal(calls, 1);
  assert.equal(page.elements.get("confirm").disabled, true);
  finish("one-order");
  await submission;
});

test("trang xác nhận hướng dẫn quay lại checkout khi chưa có đơn hàng", () => {
  const page = review({ sessionStorage: {}, cart: [] }, {
    quote: async () => { throw new Error("no checkout data"); },
    create: async () => "unexpected-order"
  });
  assert.equal(page.elements.get("order-review-empty").hidden, false);
  assert.equal(page.elements.get("confirm").disabled, true);
});

test("API báo giá lỗi mạng và quá thời gian trả lỗi có thể thử lại", async () => {
  const code = fs.readFileSync(path.join(__dirname, "../flower.com/js/order/order-store.js"), "utf8");
  for (const timeout of [false, true]) {
    let timer;
    const context = vm.createContext({
      window: {}, AbortController,
      setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout() {},
      fetch: async (_url, options) => {
        if (!timeout) throw new Error("offline");
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("timeout")));
          timer();
        });
      }
    });
    vm.runInContext(code, context);
    await assert.rejects(context.window.FlowerOrderStore.quote([{ id: "1", quantity: 1 }]),
      (error) => error.code === "order-network-error");
  }
});
