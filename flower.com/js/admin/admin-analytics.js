import { normalizeOrderStatus, orderStatusLabel, ORDER_STATUSES } from "../order/order-status.js?v=2";

const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
export function dateKey(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function periodBounds(filters, now = new Date()) {
  const today = dateKey(now);
  if (filters.period === "today") return { start: today, end: today };
  if (filters.period === "month") {
    const month = filters.month || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Tháng báo cáo không hợp lệ.");
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${last}` };
  }
  if (filters.period === "all") return { start: "", end: "" };
  if (filters.period !== "custom") throw new Error("Khoảng thời gian không hợp lệ.");
  const { start = "", end = "" } = filters;
  for (const day of [start, end]) {
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || dateKey(`${day}T12:00:00Z`) !== day)) throw new Error("Ngày báo cáo không hợp lệ.");
  }
  if (!start || !end || start > end) throw new Error("Chọn đủ ngày bắt đầu và kết thúc; ngày bắt đầu không được sau ngày kết thúc.");
  return { start, end };
}
export function paidAndDelivered(order) {
  if (normalizeOrderStatus(order.status) !== "Đã giao") return false;
  return order.paymentMethod === "qr" ? order.paymentVerified === true
    : ["đã thanh toán", "paid"].includes(String(order.paymentStatus || "").trim().toLocaleLowerCase("vi"));
}
export const revenueDate = (order) => dateKey(order.paidAt) || dateKey(order.deliveredAt) || dateKey(order.createdAt);
const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
export function buildReport(orders, products, filters, now = new Date()) {
  const bounds = periodBounds(filters, now);
  const threshold = Number(filters.lowStock ?? 5);
  if (!Number.isInteger(threshold) || threshold < 0) throw new Error("Ngưỡng tồn kho phải là số nguyên không âm.");
  const within = (day) => filters.period === "all" || Boolean(day && (!bounds.start || day >= bounds.start) && (!bounds.end || day <= bounds.end));
  const placed = orders.filter((order) => within(dateKey(order.createdAt)));
  const revenueOrders = orders.filter((order) => paidAndDelivered(order) && within(revenueDate(order)));
  const totalRevenue = revenueOrders.reduce((sum, order) => sum + money(order.total), 0);
  const states = new Map(ORDER_STATUSES.map((status) => [status, 0]));
  placed.forEach((order) => { const status = normalizeOrderStatus(order.status); states.set(status, (states.get(status) || 0) + 1); });
  const sales = new Map();
  revenueOrders.forEach((order) => {
    for (const item of order.items || []) {
      const id = String(item.productId ?? item.id);
      if (!sales.has(id)) sales.set(id, { id, title: String(item.title || id), quantity: 0, orderIds: new Set() });
      const row = sales.get(id);
      row.quantity += Math.max(0, Number(item.quantity) || 0);
      row.orderIds.add(order.id);
    }
  });
  const bestSellers = [...sales.values()].map(({ orderIds, ...row }) => ({ ...row, orders: orderIds.size }))
    .sort((a, b) => b.quantity - a.quantity || a.title.localeCompare(b.title, "vi"));
  const days = new Map();
  revenueOrders.forEach((order) => {
    const key = revenueDate(order);
    if (!days.has(key)) days.set(key, { key, revenue: 0, orders: 0 });
    const row = days.get(key); row.revenue += money(order.total); row.orders++;
  });
  let start = bounds.start || [...days.keys()].filter(Boolean).sort()[0];
  let end = bounds.end || [...days.keys()].filter(Boolean).sort().at(-1);
  const span = start && end ? (Date.parse(end) - Date.parse(start)) / 86400000 : 0;
  const monthly = span > 90;
  const buckets = new Map();
  if (monthly) {
    for (const row of days.values()) {
      const key = row.key.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { key, revenue: 0, orders: 0 });
      const bucket = buckets.get(key); bucket.revenue += row.revenue; bucket.orders += row.orders;
    }
    if (start && end) {
      let [year, month] = start.slice(0, 7).split("-").map(Number);
      while (`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` <= end.slice(0, 7)) {
        const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
        if (!buckets.has(key)) buckets.set(key, { key, revenue: 0, orders: 0 });
        if (++month > 12) { month = 1; year++; }
      }
    }
  } else {
    for (let time = Date.parse(start); Number.isFinite(time) && time <= Date.parse(end); time += 86400000) {
      const key = new Date(time).toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { key, revenue: 0, orders: 0 });
    }
  }
  const series = [...(monthly ? buckets : days).values()].sort((a, b) => (a.key || "9999").localeCompare(b.key || "9999"));
  const lowStock = products.filter((product) => Number.isInteger(Number(product.quantity)) && Number(product.quantity) >= 0 && Number(product.quantity) <= threshold)
    .map((product) => ({ id: String(product.id), title: product.title, quantity: Number(product.quantity) }))
    .sort((a, b) => a.quantity - b.quantity || a.title.localeCompare(b.title, "vi"));
  return { filters: { ...filters }, bounds, generatedAt: now, placed, revenueOrders, totalRevenue,
    average: revenueOrders.length ? totalRevenue / revenueOrders.length : 0,
    soldUnits: bestSellers.reduce((sum, row) => sum + row.quantity, 0),
    states: [...states].map(([status, count]) => ({ status, label: orderStatusLabel(status), count })),
    bestSellers, lowStock, series, monthly, currentStock: products.reduce((sum, product) => sum + Math.max(0, Number(product.quantity) || 0), 0),
    undatedOrders: orders.filter((order) => !dateKey(order.createdAt)).length };
}

export function reportSheets(report) {
  const c = (title, type = "text", width = 25) => ({ title, type, width });
  const interval = report.filters.period === "all" ? "Toàn thời gian" : `${report.bounds.start} đến ${report.bounds.end}`;
  const date = (key) => key && key.length === 10 ? new Date(`${key}T00:00:00Z`) : key || "Chưa có ngày";
  return [
    { name: "Tong quan", columns: [c("Chỉ tiêu", "text", 45), c("Giá trị", "text", 38)], rows: [
      ["Flowerflow · Báo cáo quản trị", interval], ["Múi giờ", "Asia/Ho_Chi_Minh"],
      ["Doanh thu (VND)", report.totalRevenue], ["Đơn đã giao và thanh toán", report.revenueOrders.length],
      ["Đơn đặt trong kỳ (theo ngày đặt)", report.placed.length], ["Số bó đã bán", report.soldUnits],
      ["Doanh thu / đơn (VND)", Math.round(report.average)], ["Tồn kho hiện tại", report.currentStock],
      ["Ngưỡng tồn kho thấp", Number(report.filters.lowStock ?? 5)],
      ["Cơ sở doanh thu", "Theo ngày trả tiền, dự phòng ngày giao/ngày đặt"], ["Kho", "Tồn hiện tại, không phải kho lịch sử"] ] },
    { name: "Doanh thu", columns: [c(report.monthly ? "Tháng" : "Ngày", "date"), c("Doanh thu (VND)", "money"), c("Đơn ghi nhận", "number")],
      rows: report.series.map((row) => [date(row.key), row.revenue, row.orders]) },
    { name: "Trang thai don", columns: [c("Trạng thái"), c("Số đơn theo ngày đặt", "number")], rows: report.states.map((row) => [row.label, row.count]) },
    { name: "Ban chay", columns: [c("Mã sản phẩm"), c("Tên sản phẩm", "text", 45), c("Số bó", "number"), c("Số đơn", "number")],
      rows: report.bestSellers.map((row) => [row.id, row.title, row.quantity, row.orders]) },
    { name: "Ton kho thap", columns: [c("Mã sản phẩm"), c("Tên sản phẩm", "text", 45), c("Tồn hiện tại", "number")], rows: report.lowStock.map((row) => [row.id, row.title, row.quantity]) },
    { name: "Don ghi nhan", columns: [c("Mã đơn"), c("Ngày ghi doanh thu", "date"), c("Ngày đặt", "date"), c("Trạng thái"), c("Thanh toán"), c("Doanh thu (VND)", "money")],
      rows: report.revenueOrders.map((order) => [order.id, date(revenueDate(order)), date(dateKey(order.createdAt)), orderStatusLabel(order.status), order.paymentMethod, money(order.total)]) }
  ];
}
