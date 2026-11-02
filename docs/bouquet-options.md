# Tùy chọn bó hoa

Trang chi tiết hỗ trợ thư viện ảnh, ý nghĩa hoa, kích thước, tông màu, số lượng, thiệp (300 ký tự) và ghi chú riêng (500 ký tự). Trong quản trị sản phẩm, nhập tối đa 8 ảnh bổ sung, mỗi dòng một URL, và nội dung ý nghĩa tùy chọn. Nếu chưa có ảnh bổ sung, gallery vẫn có ảnh toàn cảnh và chế độ cận cảnh phóng to từ chính ảnh gốc; không lấy ảnh của sản phẩm khác.

Chính sách mặc định nằm trong `flower.com/bouquet-options.js`: tiêu chuẩn bằng giá gốc, lớn 130%, cao cấp 160%. Tông màu không phụ thu. Tồn kho là số bó dùng chung cho các kích thước và tông màu; tông màu được ghi nhận như yêu cầu phối hoa, không giả lập ảnh hay kho riêng cho từng màu.

Giỏ hàng có mã dòng riêng cho mỗi cấu hình. `productId` trỏ tới sản phẩm gốc, còn `id` là mã dòng; `size`, `color`, `cardMessage`, `personalNote` lưu lựa chọn. Chỉ các dòng có cùng cấu hình và nội dung thiệp/ghi chú mới được gộp. Các dòng cũ chỉ có `id` vẫn hoạt động.

Ở bước thanh toán, khách có thể điền người nhận riêng, chọn ngày và khung giờ giao, chọn một trong các lời chúc gợi ý hoặc tự viết thiệp, chọn gói quà và thêm ghi chú cho cửa hàng. Những lựa chọn này được lưu ở cấp đơn hàng, hiển thị trước khi xác nhận và chuyển cùng đơn đến cửa hàng.

API báo giá và tạo đơn kiểm tra lựa chọn, tính giá theo giá sản phẩm trên Firestore và chính sách dùng chung, áp dụng ưu đãi theo sản phẩm gốc. Khi giữ/hoàn kho, cộng số lượng tất cả dòng của cùng sản phẩm trước khi cập nhật kho. Nội dung lựa chọn được lưu trong từng `order.items` và hiển thị tại giỏ hàng, checkout, xác nhận, quản trị và trang theo dõi của chủ đơn. API tra cứu công khai vẫn giới hạn thông tin cá nhân.

Kiểm tra:

- `cd flower.com; npm.cmd test`: các test logic, giá, giỏ hàng và xác thực dữ liệu.
- `npm.cmd run test:e2e -- bouquet-options.spec.js`: giao diện desktop/mobile với dữ liệu API giả lập, không cần Firebase Emulator.
- Test tích hợp `tests/integration/feature-orders.test.js`: lưu cấu hình vào Firestore, giá server và trừ/hoàn tồn kho gộp; cần Java và Firebase Emulator.
