const test = require("node:test");
const assert = require("node:assert/strict");
const products = [{ id: "a", title: "Hoa A", quantity: 0 }, { id: "b", title: "Hoa B", quantity: 5 }, { id: "c", title: "Hoa C", quantity: 10 }];
const orders = [
  { id: "1", createdAt: "2026-10-31T18:00:00Z", paidAt: "2026-11-02T01:00:00Z", status: "Đã giao", paymentMethod: "cod", paymentStatus: "Đã thanh toán", total: 270000,
    items: [{ id: "line-a", productId: "a", title: "Hoa A", quantity: 2, price: 100000 }, { id: "line-b", productId: "a", title: "Hoa A", quantity: 1, price: 100000 }] },
  { id: "2", createdAt: "2026-11-02T17:30:00Z", paidAt: "2026-11-02T17:30:00Z", status: "Đã giao", paymentMethod: "qr", paymentVerified: false, total: 100000, items: [] },
  { id: "3", createdAt: "2026-11-02T01:00:00Z", status: "Đã hủy", total: 100000, items: [] },
  { id: "4", createdAt: "2026-11-02T01:00:00Z", status: "Đang chuẩn bị", total: 100000, items: [] },
  { id: "5", createdAt: "2026-10-30T01:00:00Z", paidAt: "2026-11-02T02:00:00Z", status: "Hoàn thành", paymentMethod: "qr", paymentVerified: true, total: 500000,
    items: [{ id: "b", title: "Hoa B", quantity: 1, price: 500000 }] }
];
test("doanh thu net đúng kỳ theo giờ VN; không cộng QR chưa đối soát/hủy/chưa giao", async () => {
  const { buildReport, dateKey } = await import("../flower.com/js/admin/admin-analytics.js");
  assert.equal(dateKey("2026-10-31T18:00:00Z"), "2026-11-01");
  const report = buildReport(orders, products, { period: "custom", start: "2026-11-02", end: "2026-11-02", lowStock: 5 });
  assert.equal(report.totalRevenue, 770000);
  assert.equal(report.revenueOrders.length, 2);
  assert.equal(report.placed.length, 2);
  assert.equal(report.soldUnits, 4);
  assert.equal(report.bestSellers[0].id, "a");
  assert.equal(report.bestSellers[0].quantity, 3);
  assert.equal(report.bestSellers[0].orders, 1);
  assert.equal(report.lowStock.length, 2);
  assert.equal(report.series.reduce((sum, row) => sum + row.revenue, 0), report.totalRevenue);
});
test("khoảng ngày hợp lệ, ngày nhuận, kỳ rỗng và tổng hợp tháng", async () => {
  const { buildReport, periodBounds } = await import("../flower.com/js/admin/admin-analytics.js");
  assert.equal(periodBounds({ period: "month", month: "2028-02" }).end, "2028-02-29");
  assert.throws(() => periodBounds({ period: "custom", start: "2026-02-30", end: "2026-03-01" }));
  assert.throws(() => periodBounds({ period: "custom", start: "2026-11-03", end: "2026-11-02" }));
  const empty = buildReport([], products, { period: "month", month: "2026-11", lowStock: 0 });
  assert.equal(empty.totalRevenue, 0);
  assert.equal(empty.average, 0);
  assert.equal(empty.series.length, 30);
  assert.equal(empty.lowStock.length, 1);
  const yearly = buildReport(orders, products, { period: "custom", start: "2026-01-01", end: "2026-12-31", lowStock: 5 });
  assert.equal(yearly.monthly, true);
  assert.equal(yearly.series.length, 12);
  assert.equal(yearly.series.find((row) => row.key === "2026-11").revenue, 770000);
  assert.equal(yearly.series[0].revenue, 0);
});
test("Excel giữ 6 sheet, số VND, ngày thật và văn bản không trở thành công thức", async () => {
  const { buildReport, reportSheets } = await import("../flower.com/js/admin/admin-analytics.js");
  const { workbookBytes } = await import("../flower.com/js/admin/excel-export.js");
  const report = buildReport(orders, [{ id: "x", title: '=HYPERLINK("bad") & <test>', quantity: 0 }], { period: "all", lowStock: 5 });
  const sheets = reportSheets(report);
  assert.equal(sheets.length, 6);
  assert.equal(sheets[0].rows.find((row) => row[0] === "Doanh thu (VND)")[1], report.totalRevenue);
  assert.ok(sheets[5].rows[0][1] instanceof Date);
  const bytes = workbookBytes(sheets);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /t="inlineStr"/);
  assert.match(xml, /&amp; &lt;test&gt;/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.match(xml, /<v>770000<\/v>/);
});
