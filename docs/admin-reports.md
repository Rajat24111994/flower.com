# Báo cáo quản trị

Tab **Tổng quan** giữ các chỉ số toàn thời gian hiện có và thêm bảng báo cáo. Tab **Doanh thu** mở riêng bảng báo cáo, dùng cùng bộ lọc và cùng dữ liệu Firestore đã được Admin tải. Không có API công khai mới hoặc thay đổi quyền truy cập.

Chọn hôm nay, tháng, toàn thời gian hoặc đủ ngày bắt đầu/kết thúc rồi bấm **Áp dụng bộ lọc**. Nút **Đặt lại** đưa kỳ báo cáo về tháng hiện tại và ngưỡng tồn thấp về 5 bó. Múi giờ báo cáo là Việt Nam (`Asia/Ho_Chi_Minh`), gồm cả hai ngày biên. Ngưỡng tồn thấp mặc định 5 bó và có thể thay đổi.

- **Doanh thu:** chỉ đơn hoàn thành (`Đã giao` và các tên tương thích) và đã thanh toán. QR bắt buộc `paymentVerified: true`; COD theo trạng thái thanh toán được xác nhận. Dùng tổng tiền net trên đơn, không cộng lại giá từng sản phẩm. Ngày ghi nhận ưu tiên ngày trả tiền, rồi ngày giao, rồi ngày đặt như quy tắc báo cáo trước đây.
- **Thống kê đơn:** lọc theo ngày đặt, bao gồm cả đơn hủy/chưa hoàn thành. Doanh thu và số đơn đặt có thể khác kỳ vì chúng dùng hai mốc ngày khác nhau; giao diện nêu rõ.
- **Bán chạy:** tổng số bó trong các đơn ghi nhận doanh thu, gộp theo `productId` gốc dù có nhiều cấu hình. Một đơn chỉ được đếm một lần cho mỗi sản phẩm. Giao diện hiển thị 10 sản phẩm đầu; Excel xuất toàn bộ.
- **Tồn thấp:** tồn hiện tại ≤ ngưỡng, gồm cả hết hàng. Đây không phải số dư kho lịch sử của kỳ được lọc.
- **Biểu đồ:** theo ngày; kỳ dài hơn 90 ngày tổng hợp theo tháng. Có các kỳ không doanh thu bằng 0 và bảng dữ liệu có thể mở để đối chiếu. Số liệu thiếu ngày được ghi rõ, không tự suy diễn ngày.

File **Excel `.xlsx`** được tạo trong trình duyệt bằng OOXML, không gửi thêm dữ liệu ra dịch vụ ngoài, không cần thư viện CDN. Sáu sheet: Tổng quan, Doanh thu, Trạng thái đơn, Bán chạy, Tồn kho thấp, Đơn ghi nhận. Giá trị tiền/số lượng là số, ngày là ô ngày Excel; có định dạng VND, hàng tiêu đề cố định và bộ lọc cột. Văn bản luôn là nội dung ô, không phải công thức. Đây là ảnh chụp dữ liệu theo bộ lọc đang áp dụng, không phải workbook kết nối trực tiếp Firestore. Danh sách đơn ghi nhận không xuất tên/địa chỉ khách.

Kiểm thử: `npm.cmd test`; `npm.cmd run test:e2e -- admin-report.spec.js`. E2E xác thực bằng SDK giả lập và chạy giao diện thật; kiểm tra lọc, tổng tiền, cảnh báo tồn, cập nhật subscription, tải `.xlsx`, chặn tài khoản không có quyền và bố cục desktop/mobile. File tải đã được mở bằng ZIP reader độc lập, parse mọi XML, kiểm tra 6 sheet, tổng tiền và ô ngày. Chưa mở trực tiếp bằng Microsoft Excel hoặc chạy với Firestore production.
