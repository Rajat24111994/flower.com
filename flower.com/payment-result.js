const title = document.getElementById("payment-result-title");
const message = document.getElementById("payment-result-message");
const orderLine = document.getElementById("payment-result-order");
const retryButton = document.getElementById("payment-retry");
const returnParameters = new URLSearchParams(window.location.search);
const txnRef = returnParameters.get("vnp_TxnRef") || "";
const redirectCancelled = returnParameters.get("vnp_ResponseCode") === "24";
let pollCount = 0;

function showState(result) {
  orderLine.hidden = !result.orderId;
  orderLine.textContent = result.orderId ? `Mã đơn hàng: ${result.orderId}` : "";
  retryButton.hidden = true;
  if (result.latePayment) {
    title.textContent = "Đã nhận thanh toán muộn";
    message.textContent = "Giao dịch đã được VNPay xác nhận nhưng đơn có thể đã hết hạn. Vui lòng liên hệ cửa hàng để kiểm tra đơn hoặc hoàn tiền.";
    return;
  }
  if (result.status === "success") {
    title.textContent = "Thanh toán thành công";
    message.textContent = "VNPay đã xác nhận giao dịch với máy chủ. Cửa hàng sẽ tiếp tục xử lý đơn hàng.";
    return;
  }
  if (result.status === "failed" || result.status === "expired") {
    title.textContent = result.status === "expired" ? "Đơn đã hết thời hạn thanh toán" : "Thanh toán chưa thành công";
    message.textContent = "Bạn có thể thử thanh toán lại. Liên kết mới sẽ chỉ được tạo nếu đơn và tồn kho còn khả dụng.";
    retryButton.hidden = false;
    return;
  }
  if (result.status === "pending" && redirectCancelled) {
    title.textContent = "Bạn đã hủy giao dịch";
    message.textContent = "Đơn chưa được đánh dấu đã thanh toán. Máy chủ vẫn đang chờ IPN xác thực từ VNPay; hãy tải lại sau ít phút để kiểm tra.";
    return;
  }
  title.textContent = "Đang chờ VNPay xác nhận";
  message.textContent = "Chúng tôi chưa nhận được IPN xác nhận. Trang này sẽ tự kiểm tra lại; không đóng vai trò xác nhận thanh toán.";
}

async function loadStatus() {
  const response = await fetch(`/api/payments?action=status&txnRef=${encodeURIComponent(txnRef)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Không kiểm tra được trạng thái giao dịch.");
  showState(result);
  return result;
}

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  message.textContent = "Đang kiểm tra tồn kho và tạo liên kết VNPay mới…";
  try {
    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "retry", txnRef }),
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể tạo liên kết thanh toán.");
    const url = new URL(result.paymentUrl);
    if (![
      "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      "https://pay.vnpay.vn/vpcpay.html"
    ].includes(`${url.origin}${url.pathname}`)) {
      throw new Error("Liên kết thanh toán không hợp lệ.");
    }
    window.location.assign(url.toString());
  } catch (error) {
    message.textContent = error.message || "Không thể tạo liên kết thanh toán. Vui lòng thử lại.";
    retryButton.disabled = false;
  }
});

async function start() {
  if (!/^[a-f0-9]{32}$/.test(txnRef)) {
    title.textContent = "Thiếu mã giao dịch";
    message.textContent = "Hãy mở lại trang kết quả từ VNPay hoặc liên hệ cửa hàng.";
    return;
  }
  try {
    while (pollCount < 20) {
      const result = await loadStatus();
      if (["success", "failed", "expired"].includes(result.status) || result.latePayment) return;
      pollCount += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    message.textContent = "Máy chủ chưa nhận IPN từ VNPay. Bạn có thể tải lại trang sau ít phút để kiểm tra; đừng thanh toán lần nữa khi trạng thái còn đang chờ.";
  } catch (error) {
    title.textContent = "Chưa thể kiểm tra kết quả";
    message.textContent = error.message || "Vui lòng thử tải lại trang sau.";
  }
}

void start();
