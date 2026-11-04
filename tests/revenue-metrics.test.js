const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");

async function run() {
  const moduleSource = await readFile(require.resolve("../flower.com/revenue-metrics.js"), "utf8");
  const moduleDataUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`;
  const { createRandomDemoRevenueOrders, getRevenueMetrics } = await import(moduleDataUrl);
  const normalizeStatus = (status) => status === "Hoàn thành chuyến" ? "Đã giao" : status;
  const orderAt = (year, month, day) => new Date(year, month - 1, day, 12).toISOString();
  const orders = [
    {
      status: "Đã giao",
      createdAt: orderAt(2026, 10, 30),
      trackingHistory: [{
        status: "Đã giao",
        updatedAt: orderAt(2026, 11, 4)
      }],
      total: 250000,
      items: [{ quantity: 2 }]
    },
    {
      status: "Hoàn thành chuyến",
      createdAt: orderAt(2026, 11, 3),
      total: 150000,
      items: [{ quantity: 1 }]
    },
    {
      status: "Đang giao",
      createdAt: orderAt(2026, 11, 4),
      total: 900000,
      items: [{ quantity: 9 }]
    },
    {
      status: "Đã hủy",
      createdAt: orderAt(2026, 11, 4),
      total: 700000,
      items: [{ quantity: 7 }]
    },
    {
      status: "Đã giao",
      createdAt: orderAt(2026, 11, 4),
      trackingHistory: [{
        status: "Đã giao",
        updatedAt: orderAt(2026, 10, 31)
      }],
      total: 100000,
      items: [{ quantity: 1 }]
    }
  ];

  const periodMetrics = getRevenueMetrics(
    orders,
    { startDate: "2026-11-03", endDate: "2026-11-04" },
    normalizeStatus
  );
  assert.equal(periodMetrics.orders.length, 2);
  assert.equal(periodMetrics.totalRevenue, 400000);
  assert.equal(periodMetrics.totalSoldUnits, 3);
  assert.equal(periodMetrics.averagePerOrder, 200000);

  const allTimeMetrics = getRevenueMetrics(orders, {}, normalizeStatus);
  assert.equal(allTimeMetrics.totalRevenue, 500000);
  assert.equal(allTimeMetrics.totalSoldUnits, 4);

  const invalidRange = getRevenueMetrics(
    orders,
    { startDate: "2026-02-30", endDate: "2026-03-01" },
    normalizeStatus
  );
  assert.deepEqual(invalidRange, {
    orders: [],
    totalRevenue: 0,
    totalSoldUnits: 0,
    averagePerOrder: 0
  });

  const demoOrders = createRandomDemoRevenueOrders(100_000_000, 12_345_000, 2026, () => 0.5);
  assert.equal(demoOrders.length, 10);
  assert.equal(demoOrders.reduce((sum, order) => sum + order.total, 0), 87_655_000);
  assert.ok(demoOrders.every((order) => order.isDemoRevenue && order.status === "Đã giao"));
  assert.ok(demoOrders.every((order) => {
    const deliveredAt = new Date(order.createdAt);
    return deliveredAt.getFullYear() === 2026 && deliveredAt.getMonth() === 10;
  }));
  assert.equal(
    getRevenueMetrics(
      [...orders, ...demoOrders],
      { startDate: "2026-11-01", endDate: "2026-11-30" },
      normalizeStatus
    ).totalRevenue,
    100_000_000
  );
  assert.throws(
    () => createRandomDemoRevenueOrders(100_000_000, 100_000_001, 2026),
    RangeError
  );

  console.log("revenue-metrics test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
