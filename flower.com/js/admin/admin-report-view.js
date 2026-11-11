import { buildReport, dateKey, reportSheets } from "./admin-analytics.js?v=3";
import { downloadWorkbook } from "./excel-export.js?v=1";
const e = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const vnd = (value) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
function table(headers, rows, caption) {
  return `<div class="report-table-wrap" tabindex="0" aria-label="${e(caption)}"><table class="report-table"><caption>${e(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${e(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Chưa có dữ liệu phù hợp.</td></tr>`}</tbody></table></div>`;
}
function chart(report) {
  const rows = report.series;
  if (!rows.some((row) => row.orders > 0)) return '<p class="empty-state">Chưa có doanh thu đã ghi nhận trong kỳ.</p>';
  const width = Math.max(640, Math.min(rows.length * 34 + 90, 2600));
  const max = Math.max(1, ...rows.map((row) => row.revenue));
  const plot = width - 90, step = plot / rows.length;
  const bars = rows.map((row, i) => {
    const height = Math.max(0, row.revenue) / max * 165;
    const x = 65 + i * step, label = row.key || "Chưa có ngày";
    return `<rect x="${x + step * .15}" y="${190 - height}" width="${Math.max(1, step * .7)}" height="${height}" rx="2" fill="#8c415e"><title>${e(label)}: ${e(vnd(row.revenue))} · ${row.orders} đơn</title></rect>${i % Math.max(1, Math.ceil(rows.length / 8)) === 0 ? `<text x="${x}" y="215" font-size="11" fill="#65564e">${e(label)}</text>` : ""}`;
  }).join("");
  return `<div class="report-chart-scroll" tabindex="0" aria-label="Biểu đồ doanh thu, cuộn ngang để xem"><svg viewBox="0 0 ${width} 235" width="${width}" height="235" role="img" aria-label="Doanh thu theo ${report.monthly ? "tháng" : "ngày"}, đơn vị VND"><title>Doanh thu đã giao và thanh toán</title><desc>Số liệu đầy đủ trong bảng dưới biểu đồ.</desc><line x1="65" y1="190" x2="${width - 15}" y2="190" stroke="#cfc6bf"/><text x="5" y="20" font-size="11" fill="#65564e">${e(new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(max))} ₫</text><text x="40" y="190" font-size="11">0</text>${bars}</svg></div>`;
}
export function mountReport({ container, orders, products, filters, onFilter }) {
  const report = buildReport(orders, products, filters);
  const interval = filters.period === "all" ? "Toàn thời gian" : `${report.bounds.start} → ${report.bounds.end}`;
  const metric = (label, value, note) => `<article class="report-metric"><h3>${e(label)}</h3><strong>${e(value)}</strong><small>${e(note)}</small></article>`;
  container.innerHTML = `<section class="admin-report panel" aria-labelledby="admin-report-title">
    <div class="report-heading"><div><p class="report-eyebrow">FLOWERFLOW · BÁO CÁO</p><h2 id="admin-report-title">Doanh thu & kho hàng</h2><p id="report-period-label">${e(interval)} · Giờ Việt Nam</p></div><button type="button" class="submit-btn" id="report-export">Xuất Excel (.xlsx)</button></div>
    <form id="admin-report-filters" class="report-filters">
      <label>Khoảng thời gian<select name="period"><option value="today" ${filters.period === "today" ? "selected" : ""}>Hôm nay</option><option value="month" ${filters.period === "month" ? "selected" : ""}>Theo tháng</option><option value="custom" ${filters.period === "custom" ? "selected" : ""}>Tùy chọn ngày</option><option value="all" ${filters.period === "all" ? "selected" : ""}>Toàn thời gian</option></select></label>
      <label data-month ${filters.period !== "month" ? "hidden" : ""}>Tháng<input type="month" name="month" value="${e(filters.month)}"></label>
      <label data-custom ${filters.period !== "custom" ? "hidden" : ""}>Từ ngày<input type="date" name="start" value="${e(filters.start)}"></label>
      <label data-custom ${filters.period !== "custom" ? "hidden" : ""}>Đến ngày<input type="date" name="end" value="${e(filters.end)}"></label>
      <label>Tồn thấp (≤ số bó)<input type="number" min="0" step="1" name="lowStock" required value="${e(filters.lowStock)}"></label>
      <button class="submit-btn" type="submit">Áp dụng bộ lọc</button>
      <button class="secondary-btn" id="report-reset" type="button">Đặt lại</button>
    </form><p id="report-feedback" role="status" aria-live="polite"></p>
    <p class="report-method">Đơn hàng theo ngày đặt; doanh thu chỉ tính đơn hoàn thành, đã thanh toán và chưa hoàn tiền, theo ngày trả tiền (dự phòng ngày giao/ngày đặt). Tiền hoàn được thống kê riêng theo ngày ghi nhận hoàn tiền. Tồn kho là số hiện tại, không lọc theo ngày.</p>
    ${report.undatedOrders ? `<p class="report-warning">${report.undatedOrders} đơn thiếu ngày đặt; không được tính trong bộ lọc theo ngày.</p>` : ""}
    <div class="report-metrics">${metric("Doanh thu sau hoàn tiền", vnd(report.totalRevenue), `${report.revenueOrders.length} đơn hoàn thành, đã trả và chưa hoàn tiền`)}${metric("Đơn chưa thu / chưa xác minh", vnd(report.totalUnpaid), `${report.unpaidOrders.length} đơn, theo ngày đặt`)}${metric("Đã thu nhưng chưa giao", vnd(report.totalPaidNotDelivered), `${report.paidNotDeliveredOrders.length} đơn, gồm các đơn đã thanh toán nhưng chưa hoàn tất`)}${metric("Đã hoàn tiền trong kỳ", vnd(report.totalRefunded), `${report.refundedOrders.length} đơn, theo ngày ghi nhận hoàn tiền`)}${metric("Đơn đặt trong kỳ", report.placed.length, "Gồm mọi trạng thái, theo ngày đặt")}${metric("Số bó đã bán", report.soldUnits, "Theo đơn ghi nhận doanh thu")}${metric("Doanh thu / đơn", vnd(report.average), "Trung bình trên đơn ghi nhận")}${metric("Tồn kho hiện tại", report.currentStock, "Tất cả sản phẩm")}${metric("Sản phẩm tồn thấp", report.lowStock.length, `Ngưỡng ≤ ${filters.lowStock} bó, gồm hết hàng`)}</div>
    <div class="report-panels"><section class="report-section report-wide"><h3>Biểu đồ doanh thu theo ${report.monthly ? "tháng" : "ngày"}</h3>${chart(report)}<details><summary>Xem bảng số liệu biểu đồ</summary>${table([report.monthly ? "Tháng" : "Ngày", "Doanh thu (VND)", "Đơn ghi nhận"], report.series.map((row) => [row.key || "Chưa có ngày", vnd(row.revenue), row.orders]), "Số liệu doanh thu")}</details></section>
    <section class="report-section"><h3>Thống kê trạng thái đơn</h3>${table(["Trạng thái", "Số đơn"], report.states.map((row) => [row.label, row.count]), "Đơn đặt trong kỳ theo trạng thái")}</section>
    <section class="report-section"><h3>10 sản phẩm bán chạy</h3>${table(["Sản phẩm", "Số bó", "Số đơn"], report.bestSellers.slice(0, 10).map((row) => [row.title, row.quantity, row.orders]), "Bán chạy trong đơn hoàn thành, đã thanh toán và chưa hoàn tiền")}</section>
    <section class="report-section report-wide"><h3>Tồn kho thấp hiện tại</h3>${table(["Mã", "Sản phẩm", "Tồn", "Cảnh báo"], report.lowStock.map((row) => [row.id, row.title, row.quantity, row.quantity === 0 ? "Hết hàng" : "Sắp hết hàng"]), `Tồn kho ≤ ${filters.lowStock} bó`)}</section></div>
    <p class="report-method">Excel gồm 7 sheet: tổng quan, doanh thu sau hoàn tiền, trạng thái đơn, bán chạy (toàn bộ), tồn thấp, đơn ghi nhận và hoàn tiền. Dữ liệu xuất khớp bộ lọc đang áp dụng ở trên.</p>
  </section>`;
  const form = container.querySelector("#admin-report-filters");
  const feedback = container.querySelector("#report-feedback");
  form.elements.period.addEventListener("change", () => {
    form.querySelector("[data-month]").hidden = form.elements.period.value !== "month";
    form.querySelectorAll("[data-custom]").forEach((element) => { element.hidden = form.elements.period.value !== "custom"; });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = Object.fromEntries(new FormData(form));
    try { buildReport(orders, products, next); onFilter(next); } catch (error) { feedback.textContent = error.message; }
  });
  container.querySelector("#report-reset").addEventListener("click", () => {
    onFilter({ period: "month", month: dateKey(new Date()).slice(0, 7), start: "", end: "", lowStock: 5 });
  });
  container.querySelector("#report-export").addEventListener("click", () => {
    try {
      const period = report.filters.period === "all" ? "all" : `${report.bounds.start}_${report.bounds.end}`;
      downloadWorkbook(reportSheets(report), `flowerflow-report-${period}-${dateKey(report.generatedAt)}.xlsx`);
      feedback.textContent = "Đã tạo file Excel theo bộ lọc đang áp dụng.";
    } catch (error) { feedback.textContent = `Không thể xuất báo cáo: ${error.message}`; }
  });
  return report;
}
