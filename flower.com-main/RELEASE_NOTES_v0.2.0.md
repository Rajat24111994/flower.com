# Release notes v0.2.0

Ngày phát hành: chưa phát hành

## Tính năng

- Đặt hàng có backend thật (`/api/orders`): máy chủ báo giá, kiểm tra tồn kho, giữ hàng, chống đặt trùng và tự hủy đơn hết hạn (QR 30 phút, COD 24 giờ).
- Đơn hàng, sản phẩm, ưu đãi, phân loại, đánh giá và lời nhắn lưu trên Firestore, bảo vệ bằng Security Rules.
- Thanh toán QR: trang theo dõi đơn hiện lại mã QR, số tiền, nội dung chuyển khoản và hạn chuyển; admin xác nhận tiền hoặc ghi nhận tiền chuyển trễ.
- Thông tin người nhận, ngày giờ giao, thiệp và gói quà.
- Ưu đãi tự áp dụng mức giảm cao nhất.
- Giá lưu và hiển thị bằng số nguyên VND, làm tròn tới 1.000 ₫; tổng giỏ đúng bằng tổng từng dòng (#40).
- Đánh giá chỉ dành cho chủ đơn đã giao, mỗi đơn một lần; phản hồi của cửa hàng hiện cho khách.
- Phân quyền Owner/Admin bằng custom claims và `adminRoles` (thu hồi quyền có hiệu lực ngay).

## Đã sửa

- 32 lỗi F01–F32 từ đợt kiểm thử toàn bộ chức năng (trừ F27 – ảnh sản phẩm, đang chờ ảnh thật). Danh sách đầy đủ xem lịch sử commit `Sửa lỗi F..`.

## Kiểm thử

- Unit test: tính giá, ưu đãi, kiểm tra dữ liệu đơn hàng, trạng thái đơn, giỏ hàng, danh mục, sản phẩm.
- Feature, system và security test chạy API thật và `firestore.rules` thật trên Firebase Emulator (`tests/integration`).
- CI trên GitHub Actions cho mọi PR và mỗi lần push lên `main`, kèm báo cáo coverage.
- Smoke test sau deploy: `npm run smoke` và checklist trong `RELEASE-CHECKLIST.md`.

## Cần làm tay khi nâng cấp

- Chạy `npm run setup-firestore` để cập nhật Security Rules, index, `adminRoles` và đổi giá sản phẩm cũ từ USD sang VND.
- Đặt biến môi trường `CRON_SECRET` trên Vercel cho cron dọn đơn hết hạn.

## Hạn chế đã biết

- Thanh toán QR chưa đối soát tự động; admin phải kiểm tra sao kê rồi xác nhận.
- Nhiều sản phẩm còn dùng chung ảnh (F27).
- Giỏ hàng và danh sách yêu thích chỉ lưu theo trình duyệt.

## Kiểm tra trước phát hành

Làm theo [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md).
