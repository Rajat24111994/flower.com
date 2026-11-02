# Đánh giá sau mua và kiểm duyệt

Khách đăng nhập đúng tài khoản sở hữu đơn đã hoàn thành được gửi 1–5 sao, nhận xét tối đa 1.000 ký tự và tối đa 3 ảnh. Giữ cơ chế hiện có: mỗi đơn một đánh giá, gắn với các sản phẩm đã mua trong đơn; tên và sản phẩm lấy từ đơn trên server, không tin dữ liệu trình duyệt. Gửi lại không tạo bản thứ hai. Khách xem đánh giá của mình, kể cả đang chờ duyệt/đã ẩn, qua API kiểm tra lại quyền sở hữu đơn.

Ảnh đầu vào JPG/PNG/WebP tối đa 5 MB được trình duyệt giải mã, thu nhỏ, chuyển sang JPEG và bỏ metadata. Payload cuối mỗi ảnh tối đa 120 KB/1600px. Server kiểm tra MIME, base64, chữ ký JPEG và kích thước; ảnh lưu riêng dưới `reviewImages` trong Firestore, không đưa byte ảnh vào truy vấn danh sách đánh giá. Không cần cấu hình bucket Storage mới. Giới hạn nhỏ giữ mỗi tài liệu dưới giới hạn Firestore.

Đánh giá mới có `verifiedPurchase: true`, `authorUid`, `moderationStatus: pending`, `photoIds`. Chỉ `approved` hiển thị trên sản phẩm và được tính trung bình sao. Đánh giá cũ chưa có trạng thái cần được Admin duyệt, không tự gán nhãn đã mua. Không tạo mới đánh giá từ cache quản trị cũ.

Trong Admin → Đánh giá, lọc Chờ duyệt/Đã duyệt/Đã ẩn/Tất cả. Admin xem nguyên văn, ảnh, duyệt hoặc ẩn, ghi lý do và trả lời riêng. Firestore Rules khóa `rating`, `comment`, ảnh, tên tác giả, sản phẩm, UID và nhãn đã mua; không cho Admin tạo/xóa đánh giá. Chỉ cho sửa các trường kiểm duyệt, phản hồi và dấu xử lý, với UID/thời gian kiểm duyệt do phiên hiện tại ghi nhận. Hành động xóa cũ được thay bằng ẩn và không xóa nội dung gốc.

`/api/review-images` kiểm tra trạng thái hiện tại: công khai khi đã duyệt, còn lại chỉ chủ đánh giá hoặc Admin đang có `adminRoles`. Ảnh dùng `private, no-store`; ẩn đánh giá sẽ chặn các yêu cầu ảnh công khai tiếp theo (không thể thu hồi ảnh mà người khác đã tải trước đó). Byte ảnh không cho client Firestore ghi/đọc trực tiếp.

## Triển khai Firebase bắt buộc

Push Git/Vercel không tự triển khai Firestore Rules/indexes. Sau khi đăng nhập Firebase bằng tài khoản quản lý đúng project, chạy từ `flower.com`:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project web-ban-hoa-9fe0b
```

Quyền khóa nội dung tại lớp dữ liệu và truy vấn danh sách đã duyệt chỉ hoạt động đầy đủ sau khi triển khai các file `firestore.rules` và `firestore.indexes.json`. Index mới cần thời gian xây dựng. Không dùng service-account key trong frontend. Phiên làm việc này chỉ kiểm thử project `demo-flowerflow` trên Emulator, không triển khai Firebase production vì chưa có thông tin xác thực.

## Kiểm thử

- Unit: JPEG/giới hạn ảnh, kiểu file, client từ chối sửa nội dung gốc.
- Emulator Auth + Firestore: đúng chủ đơn đã giao; tạo và giữ nội dung đánh giá, quyền ảnh trước/sau duyệt/ẩn; Rules chặn Admin sửa sao/nhận xét/ảnh/tác giả, tạo/xóa giả, đọc ảnh thô; khách chỉ xem đánh giá công khai hoặc của mình.
- Browser desktop/mobile: chọn ảnh/xem trước, tối ưu JPEG, giữ bản nháp khi lỗi, trạng thái chờ duyệt, Admin duyệt/ẩn và sản phẩm chỉ hiển thị đánh giá đã duyệt.

Java 21 phục vụ kiểm thử nằm trong `.tools/` (Git bỏ qua), không cài vào hệ thống. Đặt `JAVA_HOME` và thêm `bin` vào PATH của tiến trình trước khi chạy Emulator. Thư viện kiểm thử dùng `tests/package-lock.json`.
