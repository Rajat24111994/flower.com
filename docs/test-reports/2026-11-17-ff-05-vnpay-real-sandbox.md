# FF-05 — VNPay sandbox và IPN thực tế: chưa hoàn thành

Issue #160. Ngày kiểm tra: 17/11/2026, Asia/Bangkok.
Baseline main: `98a6a331dda56e5fa1584a2cf04303ba0d2b00ac`.

## Thông tin đã xác minh

- Workspace chỉ có `.env.example`, không có `.env` được điền; không có tên biến
  VNPAY/FIREBASE/PUBLIC_APP_URL liên quan trong process làm việc.
- GitHub repository chỉ có tên secret `CRON_SECRET`, variable `FLOWER_APP_URL`
  còn trỏ URL Vercel cũ. Không đọc giá trị secret hoặc suy ra cấu hình Render từ đây.
- Không có merchant sandbox, staging origin và quyền xem callback/log provider được
  xác nhận cho lần kiểm tra này. Không tạo đơn hoặc giao dịch trên production.
- Các test VNPay hiện có ký callback bằng secret fixture và gọi local Emulator.
  Chúng kiểm tra nghiệp vụ/chữ ký, không phải IPN do VNPay gửi qua Internet.

Người dùng đã chọn: **để #160 mở và tiếp tục #161–#164**.

## Điều kiện còn thiếu để nghiệm thu

1. Merchant sandbox được cấp, hash secret đặt trong secret manager của staging,
   `VNPAY_ENV=sandbox`, Firebase project thử nghiệm và PUBLIC_APP_URL đúng HTTPS origin.
2. Merchant cấu hình IPN URL `/api/vnpay-ipn`; có quyền đối chiếu transaction với
   log đã lọc thông tin nhạy cảm và dữ liệu order/paymentTransactions thử nghiệm.
3. Người kiểm thử hoàn tất bước thanh toán sandbox trên trang VNPay. Ghi TxnRef,
   thời gian, số tiền và bằng chứng IPN thật; không ghi thông tin ngân hàng/secret.
4. Đối chiếu thành công, hủy/thất bại, callback lặp, tiền đến muộn; sai chữ ký/số tiền
   kiểm tra riêng bằng fixture. Không gọi callback tự ký là bằng chứng provider thật.

## Cập nhật kiểm thử mã nguồn (18/11/2026)

- `tests/UnitTests/vnpay.test.js`: 4/4 pass.
- Kiểm tra chữ ký IPN, timestamp GMT+7, cấu hình sandbox và origin HTTPS.
- Vẫn chưa có merchant sandbox/secret/IPN thật, nên chưa nghiệm thu end-to-end.
