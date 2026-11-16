# Tìm kiếm và bộ lọc

`flower.com/catalog-search.js` dùng chung cho giao diện và test. Tìm kiếm bỏ dấu, không phân biệt hoa thường, chấp nhận các từ không liền nhau/đảo thứ tự và nhận diện tên loài Việt/Anh (ví dụ `rose`, `hoa hong`). Kết quả khớp tên được ưu tiên khi chọn “Phù hợp nhất”.

Các bộ lọc kết hợp bằng AND: loài/phân loại, khoảng giá VND, màu, dịp tặng. Khoảng giá nhập tay bao gồm hai đầu mút. Các mức giá có sẵn giữ biên dưới 1.500.000, từ 1.500.000 đến dưới 2.000.000 và từ 2.000.000. Giá nhập tay thay mức có sẵn; khoảng sai sẽ báo lỗi. Có số lượng kết quả, thông báo không tìm thấy và liên kết xóa toàn bộ bộ lọc.

Bộ lọc lưu trên URL (`q`, `flower`, `min`, `max`, `price`, `color`, `occasion`, `sort`) để tải lại/chia sẻ. Các liên kết cũ dùng `search` hoặc `flower=rose` vẫn hoạt động. Tìm kiếm từ trang chi tiết trở về danh sách kết quả.

Metadata sản phẩm tùy chọn:

- `flowerTypes`: danh sách tên/mã loài, bổ sung cho nhận diện từ tên và mô tả.
- `colors`, `occasions`: danh sách màu/dịp bằng tiếng Việt. Quản trị nhập các giá trị cách nhau bằng dấu phẩy. Danh sách không rỗng được ưu tiên; khi để trống, hệ thống nhận diện từ mô tả. Màu sắc ưu tiên đoạn “phối sắc” để tránh nhầm tên hoa hồng thành màu hồng.
- `soldCount`: số bó đã bán được ghi nhận, dùng sắp xếp phổ biến giảm dần. Khi quản trị chuyển đơn sang “Đã giao”, transaction cập nhật tổng số bó theo sản phẩm gốc và đặt `salesCounted` trên đơn. Gửi lại trạng thái không tăng lần nữa. Hủy và nhận lại hàng sẽ giảm chỉ số. Đơn chờ chưa được tính.

Không tự tạo số liệu bán hoặc tự cập nhật lại lịch sử đơn cũ. Chỉ số bắt đầu được ghi nhận từ các cập nhật sau thay đổi này (hoặc từ dữ liệu `soldCount` đã có). Khi chưa có chỉ số, giao diện nói rõ và sắp theo tên.

Kiểm thử: `npm.cmd test` trong `flower.com`; chạy browser với `npm.cmd run test:e2e -- catalog-search.spec.js bouquet-options.spec.js`. Browser dùng dữ liệu giả lập để kiểm tra giao diện, không sửa dữ liệu production.
