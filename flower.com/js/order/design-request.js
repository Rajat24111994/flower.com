const message = document.getElementById("design-request-message");
const details = document.getElementById("design-request-details");
const content = document.getElementById("design-request-content");
const historyList = document.getElementById("design-request-history");
const requestId = new URLSearchParams(location.search).get("id") || "";
let accessToken = "";
let currentRequest = null;

function appendDetail(label, value) {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value || "—"}`;
  content.append(row);
}

function displayRequest(request) {
  currentRequest = request;
  details.hidden = false;
  document.getElementById("design-request-title").textContent = `Yêu cầu #${request.id}`;
  document.getElementById("design-request-status").textContent = `Trạng thái: ${request.status}`;
  content.replaceChildren();
  appendDetail("Người nhận", request.customerName);
  appendDetail("Điện thoại", request.phone);
  appendDetail("Địa chỉ", request.address);
  appendDetail("Ngày giao", request.deliveryDate);
  appendDetail("Khung giờ", request.deliveryTime);
  appendDetail("Loại hoa", (request.stems || []).map((item) => `${item.title} × ${item.quantity} (${item.color}, ${item.role === "main" ? "hoa chính" : "hoa phụ"})`).join(", "));
  appendDetail("Bố cục / kích thước", `${request.design?.arrangement || ""} · ${request.design?.size || ""}`);
  appendDetail("Kiểu gói", `${request.design?.wrapStyle || ""} · ${request.design?.paperMaterial || ""} · ${request.design?.paperColor || ""}`);
  appendDetail("Dự toán hoa và phí gói", new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(request.estimatedTotal || 0));
  if (request.quotedTotal > 0) appendDetail("Báo giá cuối của cửa hàng", new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(request.quotedTotal));
  appendDetail("Ghi chú báo giá", request.quoteNote);
  appendDetail("Yêu cầu đặc biệt", request.specialRequest);
  if (request.referenceImage) {
    const image = document.createElement("img");
    image.src = request.referenceImage;
    image.alt = "Ảnh mẫu thiết kế đã gửi";
    image.className = "design-reference-preview";
    content.append(image);
  }
  historyList.replaceChildren();
  (request.history || []).forEach((event) => {
    const row = document.createElement("p");
    row.textContent = `${event.status} · ${event.detail || ""} · ${event.createdAt ? new Date(event.createdAt).toLocaleString("vi-VN") : ""}`;
    historyList.append(row);
  });
  const quoteActions = document.getElementById("design-quote-actions");
  quoteActions.hidden = request.status !== "Chờ khách xác nhận";
  document.getElementById("design-quote-text").textContent = `Cửa hàng báo giá ${new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(request.quotedTotal || 0)}. Chấp nhận để cửa hàng bắt đầu xử lý hoặc từ chối để hủy yêu cầu.`;
  message.textContent = "";
}

async function loadRequest() {
  if (!requestId || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
    message.textContent = "Mã yêu cầu không hợp lệ.";
    return;
  }
  const saved = FlowerSafeStorage.readJson("flowerDesignRequestAccess", { fallback: {} });
  accessToken = String(saved?.[requestId] || "");
  if (!accessToken) {
    message.textContent = "Thiết bị này không có mã truy cập yêu cầu. Hãy mở lại liên kết trên thiết bị đã gửi yêu cầu hoặc sử dụng mã truy cập bạn đã lưu.";
    return;
  }
  try {
    const result = await FlowerOrderStore.getDesignRequest(requestId, accessToken);
    displayRequest(result.request);
  } catch (error) {
    console.error("Không thể tải yêu cầu thiết kế:", error);
    message.textContent = error.message || "Chưa thể tải yêu cầu thiết kế.";
  }
}

async function respond(response) {
  if (!currentRequest || currentRequest.status !== "Chờ khách xác nhận") return;
  if (response === "reject" && !window.confirm("Bạn có chắc muốn từ chối báo giá và hủy yêu cầu này?")) return;
  const buttons = [...document.querySelectorAll("#design-quote-actions button")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await FlowerOrderStore.respondToDesignQuote(requestId, accessToken, response);
    displayRequest(result.request);
    message.textContent = response === "accept"
      ? "Đã chấp nhận báo giá. Cửa hàng sẽ bắt đầu xử lý thiết kế và liên hệ bạn."
      : "Đã từ chối báo giá; yêu cầu đã được hủy.";
  } catch (error) {
    console.error("Không thể phản hồi báo giá:", error);
    message.textContent = error.message || "Chưa thể cập nhật phản hồi.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.getElementById("design-quote-accept").addEventListener("click", () => { void respond("accept"); });
document.getElementById("design-quote-reject").addEventListener("click", () => { void respond("reject"); });
loadRequest();
