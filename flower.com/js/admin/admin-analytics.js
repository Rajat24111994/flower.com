import { normalizeOrderStatus, orderStatusLabel, ORDER_STATUSES } from "../order/order-status.js?v=2";

const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
export function dateKey(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function shiftDays(dateStr, delta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekBounds(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(Date.UTC(y, m - 1, d + diffToMonday));
  const sunday = new Date(Date.UTC(y, m - 1, d + diffToMonday + 6));
  const fmt = (dt) => {
    const yr = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const da = String(dt.getUTCDate()).padStart(2, "0");
    return `${yr}-${mo}-${da}`;
  };
  return { monday: fmt(monday), sunday: fmt(sunday) };
}

export function periodBounds(filters, now = new Date()) {
  const today = dateKey(now);
  if (filters.period === "today") return { start: today, end: today };
  if (filters.period === "7days" || filters.period === "last7days") {
    return { start: shiftDays(today, -6), end: today };
  }
  if (filters.period === "30days" || filters.period === "last30days") {
    return { start: shiftDays(today, -29), end: today };
  }
  if (filters.period === "thisMonth") {
    const month = today.slice(0, 7);
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
  }
  if (filters.period === "thisYear" || filters.period === "year") {
    const year = today.slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (filters.period === "month") {
    const month = filters.month || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Tháng báo cáo không hợp lệ.");
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
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
export function isOrderPaid(order) {
  return ["qr", "vnpay"].includes(order.paymentMethod) ? order.paymentVerified === true
    : ["đã thanh toán", "paid", "da_thanh_toan"].includes(String(order.paymentStatus || "").trim().toLocaleLowerCase("vi"));
}
export function paidAndDelivered(order) {
  return normalizeOrderStatus(order.status) === "Đã giao" && isOrderPaid(order);
}
export const revenueDate = (order) => dateKey(order.paidAt) || dateKey(order.deliveredAt) || dateKey(order.createdAt);
export const refundDate = (order) => dateKey(order.paymentRefundedAt) || dateKey(order.createdAt);
const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
export function buildReport(orders, products, filters, now = new Date()) {
  const bounds = periodBounds(filters, now);
  const threshold = Number(filters.lowStock ?? 5);
  if (!Number.isInteger(threshold) || threshold < 0) throw new Error("Ngưỡng tồn kho phải là số nguyên không âm.");
  const within = (day) => filters.period === "all" || Boolean(day && (!bounds.start || day >= bounds.start) && (!bounds.end || day <= bounds.end));
  const placed = orders.filter((order) => within(dateKey(order.createdAt)));
  const revenueOrders = orders.filter((order) => paidAndDelivered(order)
    && order.paymentRefunded !== true
    && within(revenueDate(order)));
  const totalRevenue = revenueOrders.reduce((sum, order) => sum + money(order.total), 0);
  const refundedOrders = orders.filter((order) => order.paymentRefunded === true && within(refundDate(order)));
  const totalRefunded = refundedOrders.reduce((sum, order) => sum + money(order.paymentRefundAmount ?? order.total), 0);
  const unpaidOrders = orders.filter((order) => order.paymentRefunded !== true && !isOrderPaid(order)
    && within(dateKey(order.createdAt)));
  const totalUnpaid = unpaidOrders.reduce((sum, order) => sum + money(order.total), 0);
  const paidNotDeliveredOrders = orders.filter((order) => order.paymentRefunded !== true && isOrderPaid(order)
    && !paidAndDelivered(order) && within(revenueDate(order)));
  const totalPaidNotDelivered = paidNotDeliveredOrders.reduce((sum, order) => sum + money(order.total), 0);
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
  const orderDates = revenueOrders.map(revenueDate).filter(Boolean).sort();
  const today = dateKey(now);
  let start = bounds.start || orderDates[0] || today;
  let end = bounds.end || orderDates.at(-1) || today;
  if (start > end) end = start;

  const validGroupings = ["day", "week", "month", "year"];
  let groupBy = filters.groupBy;
  if (!validGroupings.includes(groupBy)) {
    groupBy = "day";
  }
  const monthly = groupBy === "month";

  const buckets = new Map();

  if (groupBy === "year") {
    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    for (let yr = startYear; yr <= endYear; yr++) {
      const key = String(yr);
      buckets.set(key, { key, label: key, fullLabel: `Năm ${key}`, revenue: 0, orders: 0 });
    }
    revenueOrders.forEach((order) => {
      const key = revenueDate(order).slice(0, 4);
      if (buckets.has(key)) {
        const row = buckets.get(key);
        row.revenue += money(order.total);
        row.orders++;
      }
    });
  } else if (groupBy === "month") {
    let [year, month] = start.slice(0, 7).split("-").map(Number);
    const endMonthKey = end.slice(0, 7);
    while (`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` <= endMonthKey) {
      const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
      const label = `${String(month).padStart(2, "0")}/${year}`;
      buckets.set(key, { key, label, fullLabel: `Tháng ${label}`, revenue: 0, orders: 0 });
      if (++month > 12) { month = 1; year++; }
    }
    revenueOrders.forEach((order) => {
      const key = revenueDate(order).slice(0, 7);
      if (buckets.has(key)) {
        const row = buckets.get(key);
        row.revenue += money(order.total);
        row.orders++;
      }
    });
  } else if (groupBy === "week") {
    const startMon = weekBounds(start).monday;
    const endMon = weekBounds(end).monday;
    for (let curr = startMon; curr <= endMon; curr = shiftDays(curr, 7)) {
      const sun = shiftDays(curr, 6);
      const label = curr.slice(0, 4) === sun.slice(0, 4)
        ? `${curr.slice(8, 10)}/${curr.slice(5, 7)} - ${sun.slice(8, 10)}/${sun.slice(5, 7)}`
        : `${curr.slice(8, 10)}/${curr.slice(5, 7)}/${curr.slice(2, 4)} - ${sun.slice(8, 10)}/${sun.slice(5, 7)}/${sun.slice(2, 4)}`;
      const fullLabel = `Tuần ${curr.slice(8, 10)}/${curr.slice(5, 7)}/${curr.slice(0, 4)} – ${sun.slice(8, 10)}/${sun.slice(5, 7)}/${sun.slice(0, 4)}`;
      buckets.set(curr, { key: curr, label, fullLabel, startDay: curr, endDay: sun, revenue: 0, orders: 0 });
    }
    revenueOrders.forEach((order) => {
      const day = revenueDate(order);
      const mon = weekBounds(day).monday;
      if (buckets.has(mon)) {
        const row = buckets.get(mon);
        row.revenue += money(order.total);
        row.orders++;
      }
    });
  } else {
    for (let curr = start; curr <= end; curr = shiftDays(curr, 1)) {
      const label = `${curr.slice(8, 10)}/${curr.slice(5, 7)}`;
      const fullLabel = `${curr.slice(8, 10)}/${curr.slice(5, 7)}/${curr.slice(0, 4)}`;
      buckets.set(curr, { key: curr, label, fullLabel, revenue: 0, orders: 0 });
    }
    revenueOrders.forEach((order) => {
      const key = revenueDate(order);
      if (buckets.has(key)) {
        const row = buckets.get(key);
        row.revenue += money(order.total);
        row.orders++;
      }
    });
  }

  const series = [...buckets.values()].sort((a, b) => (a.key || "9999").localeCompare(b.key || "9999"));
  const lowStock = products.filter((product) => Number.isInteger(Number(product.quantity)) && Number(product.quantity) >= 0 && Number(product.quantity) <= threshold)
    .map((product) => ({ id: String(product.id), title: product.title, quantity: Number(product.quantity) }))
    .sort((a, b) => a.quantity - b.quantity || a.title.localeCompare(b.title, "vi"));
  return { filters: { ...filters }, bounds, generatedAt: now, placed, revenueOrders, totalRevenue, refundedOrders, totalRefunded,
    unpaidOrders, totalUnpaid, paidNotDeliveredOrders, totalPaidNotDelivered,
    average: revenueOrders.length ? totalRevenue / revenueOrders.length : 0,
    soldUnits: bestSellers.reduce((sum, row) => sum + row.quantity, 0),
    states: [...states].map(([status, count]) => ({ status, label: orderStatusLabel(status), count })),
    bestSellers, lowStock, series, monthly, groupBy, currentStock: products.reduce((sum, product) => sum + Math.max(0, Number(product.quantity) || 0), 0),
    undatedOrders: orders.filter((order) => !dateKey(order.createdAt)).length };
}

export function reportSheets(report) {
  const c = (title, type = "text", width = 25) => ({ title, type, width });
  const interval = report.filters.period === "all" ? "Toàn thời gian" : `${report.bounds.start} đến ${report.bounds.end}`;
  const date = (key) => key && key.length === 10 ? new Date(`${key}T00:00:00Z`) : key || "Chưa có ngày";
  const groupTitle = report.groupBy === "year" ? "Năm" : report.groupBy === "month" || report.monthly ? "Tháng" : report.groupBy === "week" ? "Tuần" : "Ngày";
  return [
    { name: "Tong quan", columns: [c("Chỉ tiêu", "text", 45), c("Giá trị", "text", 38)], rows: [
      ["Flowerflow · Báo cáo quản trị", interval], ["Múi giờ", "Asia/Ho_Chi_Minh"],
      ["Doanh thu sau hoàn tiền (VND)", report.totalRevenue], ["Đơn đã giao, thanh toán và chưa hoàn tiền", report.revenueOrders.length],
      ["Đơn chưa thu/chưa xác minh trong kỳ", report.unpaidOrders.length], ["Giá trị đơn chưa thu (VND)", report.totalUnpaid],
      ["Đơn đã thu nhưng chưa giao trong kỳ", report.paidNotDeliveredOrders.length], ["Giá trị đơn đã thu nhưng chưa giao (VND)", report.totalPaidNotDelivered],
      ["Đơn đã hoàn tiền trong kỳ", report.refundedOrders.length], ["Tổng tiền hoàn (VND)", report.totalRefunded],
      ["Đơn đặt trong kỳ (theo ngày đặt)", report.placed.length], ["Số bó đã bán", report.soldUnits],
      ["Doanh thu / đơn (VND)", Math.round(report.average)], ["Tồn kho hiện tại", report.currentStock],
      ["Ngưỡng tồn kho thấp", Number(report.filters.lowStock ?? 5)],
      ["Cơ sở doanh thu", "Theo ngày trả tiền, dự phòng ngày giao/ngày đặt"], ["Kho", "Tồn hiện tại, không phải kho lịch sử"] ] },
    { name: "Doanh thu", columns: [c(groupTitle, report.groupBy === "day" ? "date" : "text"), c("Doanh thu (VND)", "money"), c("Đơn ghi nhận", "number")],
      rows: report.series.map((row) => [row.fullLabel || (report.groupBy === "day" ? date(row.key) : row.label || row.key), row.revenue, row.orders]) },
    { name: "Trang thai don", columns: [c("Trạng thái"), c("Số đơn theo ngày đặt", "number")], rows: report.states.map((row) => [row.label, row.count]) },
    { name: "Ban chay", columns: [c("Mã sản phẩm"), c("Tên sản phẩm", "text", 45), c("Số bó", "number"), c("Số đơn", "number")],
      rows: report.bestSellers.map((row) => [row.id, row.title, row.quantity, row.orders]) },
    { name: "Ton kho thap", columns: [c("Mã sản phẩm"), c("Tên sản phẩm", "text", 45), c("Tồn hiện tại", "number")], rows: report.lowStock.map((row) => [row.id, row.title, row.quantity]) },
    { name: "Don ghi nhan", columns: [c("Mã đơn"), c("Ngày ghi nhận", "date"), c("Ngày đặt", "date"), c("Trạng thái đơn"), c("Phương thức"), c("Trạng thái thanh toán"), c("Phân loại"), c("Số tiền (VND)", "money")],
      rows: [
        ...report.revenueOrders.map((order) => [order.id, date(revenueDate(order)), date(dateKey(order.createdAt)), orderStatusLabel(order.status), order.paymentMethod, order.paymentStatus || "Đã thanh toán", "Đã thu", money(order.total)]),
        ...report.unpaidOrders.map((order) => [order.id, date(dateKey(order.createdAt)), date(dateKey(order.createdAt)), orderStatusLabel(order.status), order.paymentMethod, order.paymentStatus || "Chưa thanh toán", "Chưa thu / chưa xác minh", money(order.total)]),
        ...report.paidNotDeliveredOrders.map((order) => [order.id, date(revenueDate(order)), date(dateKey(order.createdAt)), orderStatusLabel(order.status), order.paymentMethod, order.paymentStatus || "Đã thanh toán", "Đã thu, chưa giao", money(order.total)])
      ] },
    { name: "Hoan tien", columns: [c("Mã đơn"), c("Ngày ghi hoàn tiền", "date"), c("Ngày đặt", "date"), c("Thanh toán"), c("Số tiền hoàn (VND)", "money"), c("Mã giao dịch hoàn tiền")],
      rows: report.refundedOrders.map((order) => [order.id, date(refundDate(order)), date(dateKey(order.createdAt)), order.paymentMethod, money(order.paymentRefundAmount ?? order.total), order.paymentRefundReference || "Chưa có mã giao dịch"]) }
  ];
}
