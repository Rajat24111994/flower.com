# Hợp đồng API v1 cho giai đoạn in-memory

Host: `FlowerFlow.Backend`, URL local mặc định `http://localhost:5090`.
API bắt đầu bằng `/api/v1`; schema request/response chi tiết nằm ở `/openapi/v1.json`
và Swagger `/swagger`. Đây là baseline để kiểm thử và thay adapter sau này,
không phải hợp đồng đã chuyển cho frontend production.

## Ranh giới kiến trúc

Controller nhận DTO và điều phối HTTP; service kiểm tra nghiệp vụ, quyền và giao dịch;
entity lưu trạng thái nội bộ; response DTO định nghĩa JSON công khai. Thêm trường
cho entity không tự thêm trường vào response. Repository không lộ kiểu Firebase/EF.

Mọi thay đổi đơn/kho/idempotency và audit liên quan phải cùng commit hoặc cùng rollback.
Một thao tác trong service dùng chung một session, không mở unit of work lồng nhau.
Adapter SQL tương lai phải chứng minh lại các bảo đảm bằng kiểm thử transaction và
concurrency; không giả định khóa trong bộ nhớ bảo vệ được nhiều instance.

## JSON, số tiền và định danh

- JSON dùng camelCase. Gửi số JSON cho giá, số lượng, số tiền; không gửi chuỗi chứa số.
- Giá/tổng/phí là VND nguyên; tổng không vượt số nguyên an toàn `9007199254740991`.
  Giá tạo sản phẩm ít nhất 1.000 VND. API đổi giá cành hoa giới hạn 1.000–1.000.000.000 VND.
- Stock là số nguyên không âm. Delta điều chỉnh kho khác 0, có lý do; không được làm stock âm.
- `id` của dòng giỏ khác `productId`: nhiều dòng khác tùy chọn có thể cùng một sản phẩm.
  Tổng nhu cầu kho và giới hạn khách phải gộp theo productId sau chuẩn hóa.
- Chuẩn hóa checkout theo quy tắc cũ: trim ID dòng/sản phẩm, mã ưu đãi/khu vực,
  tên/liên hệ/lịch giao và idempotencyKey; không tự đổi hoa/thường của mã định danh.
- Khách không gửi giá của từng dòng để quyết định tổng. Server lấy giá hiện tại và tính lại.

## Sản phẩm, danh mục, giá và kho

- Tên sản phẩm tối đa 120 ký tự; mô tả tối đa 1.000; ảnh chính hợp lệ và tối đa 8 ảnh phụ.
- `saleType`: `ready_made` hoặc `flower`; `status`: `active` hoặc `hidden`.
- Xóa danh mục đưa các sản phẩm về chưa phân loại trong cùng giao dịch; đổi tên không làm mất liên kết.
- DELETE sản phẩm trên API mới là ẩn, không xóa dữ liệu đơn đã đặt.
- `expectedVersion` phải khớp phiên bản đã đọc khi cập nhật. Trả `409 version-conflict`
  khi dữ liệu đã đổi; client phải đọc lại trước khi quyết định gửi cập nhật mới.
- Giá cành hoa đi qua API Owner để ghi lịch sử, không sửa lén qua PUT sản phẩm.
- Tồn kho đi qua inventory-adjustments hoặc luồng đơn hàng để giữ lịch sử và chống ghi đè.

## Giỏ, báo giá và đặt hàng

- Giỏ thuộc tài khoản hiện tại; giỏ chưa có version 0. Giỏ là bản nháp, chưa giữ kho.
- Báo giá nhận 1–50 dòng, mỗi dòng 1–50 đơn vị; ID dòng không trùng sau chuẩn hóa.
- Cành hoa phải thuộc customBouquetId; sản phẩm làm sẵn không được gắn vào bó tùy chỉnh.
  Mỗi bó tối đa 50 cành, phí gói tính theo cấu hình bậc hiện tại.
- Tái sử dụng quy tắc giá backend cũ; không tự thêm hệ số kích thước phía trình duyệt.
  Ưu đãi được kiểm tra trạng thái và ngày theo Việt Nam; làm tròn giảm giá theo quy tắc cũ.
- Checkout cần ngày `yyyy-MM-dd`, khung giờ `08:00–11:00`, `11:00–14:00`,
  `14:00–17:00` hoặc `17:00–20:00`. Lịch theo Asia/Ho_Chi_Minh; không giao quá khứ;
  sau 15:00 không chọn giao trong ngày; giờ bắt đầu phải ở tương lai nếu cùng ngày.
- `expectedTotals` gồm subtotal, savings, tax, wrappingFee, shippingFee, total. Server
  tính lại ngay trong giao dịch; khác tổng thì `409 price-changed`, không tạo đơn/giữ kho.
- Khách chưa đăng nhập đặt tối đa 5 đơn vị mỗi productId đã gộp. Tạo đơn giới hạn
  5/IP, 3/số điện thoại, 5/tài khoản trong 15 phút; replay hợp lệ không tính thành đơn mới.

## Idempotency

`idempotencyKey` là UUID v4, được trim theo validator trước khi tìm/lưu yêu cầu.
Gửi lại cùng key, cùng tài khoản và cùng dữ liệu chuẩn hóa trả cùng ID đơn và tổng cũ,
không giữ kho thêm lần nữa. Khác nội dung/tài khoản trên key đã dùng trả
`409 idempotency-conflict`. Không tự đổi sang key mới khi retry một request chưa rõ kết quả.

## Vòng đời đơn và kho

```text
Chờ xác nhận → Đang chuẩn bị → Đang giao → Đã giao
      └──────────── có thể hủy ──────────────┘
Đã hủy → Chờ xác nhận (khôi phục có kiểm tra kho)
```

- COD giữ kho 5 phút, QR 30 phút; VNPay giữ 15 phút khi đơn còn chờ xác nhận.
- Cập nhật đơn vẫn chờ xác nhận phải giữ nguyên deadline, không xóa hoặc kéo dài hạn.
- Xác nhận chuẩn bị hoặc thanh toán hợp lệ ngăn đơn tự hết hạn; cleanup không hoàn kho đơn đã thanh toán.
- Hết hạn/hủy chỉ hoàn kho một lần. Đơn đã giao chỉ hoàn kho khi xác nhận hàng đã trả (`restockSold=true`).
- Khôi phục đơn đã giải phóng kho phải kiểm tra và giữ kho lại; đơn chưa thanh toán có deadline mới.
- Cập nhật Đang giao cần location và estimatedDelivery; cập nhật trạng thái có expectedVersion.
- Số đã bán tăng một lần khi giao, giảm khi có xác nhận trả hàng; không cộng lặp khi cập nhật cùng trạng thái.

## Thanh toán, đánh giá và thiết kế

- `cod`, `qr`, `vnpay` là phương thức trên đơn; gateway ở host mới chỉ là simulator.
- Simulator chỉ Owner; đối soát QR/ghi nhận hoàn tiền chỉ Admin/Owner. Không gửi credentials thật.
- Đối soát phải đúng số tiền và mã tham chiếu hợp lệ; tiền đến sau hủy không tự khôi phục kho.
- Callback lặp không ghi thanh toán lại. Kết quả thất bại của attempt cũ không ghi đè attempt đang hoạt động.
- Ghi nhận hoàn tiền không tự hủy đơn/hoàn kho; từ chối hoàn lặp hoặc hoàn khi chưa xác nhận thanh toán.
- Chủ đơn đã giao được gửi một đánh giá; ảnh JPEG tối đa 3 ảnh, 120 KB/ảnh, 1600px.
  Chờ kiểm duyệt trước khi công khai; không đưa orderId/authorId vào response đánh giá công khai.
- Thiết kế kiểm tra lựa chọn, màu, ngân sách, cành và lịch giao; ước tính chưa giữ kho.
  Admin gửi báo giá; khách chấp nhận/từ chối báo giá đang chờ và đúng version.

## Quyền và dữ liệu riêng tư

Danh tính giả lập local: owner, admin, customer-a, customer-b qua X-Development-User.
Không có header là khách; header không hợp lệ trả 401, không âm thầm coi là khách.
Host không khởi động ở Production và chỉ nhận kết nối loopback.

- Khách chỉ đọc đầy đủ đơn/giỏ của mình; tài khoản khác nhận 404.
- Tra cứu công khai dùng mã đơn + điện thoại, không lộ tên/điện thoại/địa chỉ/vị trí nội bộ.
  Giới hạn 20 lần/10 phút, tính cả lần không tìm thấy.
- Quyền Owner cần cho đổi giá cành hoa/cấp thu hồi Admin; không tự hạ quyền Owner qua API này.
- Khách dùng X-Payment-Reference để truy cập luồng thanh toán không có tài khoản;
  thiết kế dùng X-Design-Token. Không đưa token thiết kế vào query string.

## HTTP và lỗi

| Trường hợp | Status |
| --- | --- |
| GET, báo giá, cập nhật thành công | 200 |
| Tạo sản phẩm/danh mục/đơn/đánh giá/thiết kế/payment attempt | 201 cùng Location |
| Ẩn sản phẩm hoặc xóa danh mục thành công | 204, không có response body |
| JSON hoặc dữ liệu không hợp lệ | 400 |
| Chưa xác thực/không có quyền | 401/403 |
| Không tồn tại hoặc không được xem tài nguyên riêng | 404 |
| Xung đột version, giá, kho, idempotency hoặc trạng thái | 409 |
| Vượt giới hạn | 429 và Retry-After |

Lỗi dùng ProblemDetails với status, code và traceId; lỗi validation có thêm errors.
Client xử lý theo status/code, không phân tích câu thông báo tiếng Việt. Swagger phải
ghi đúng status trả về thực tế; test OpenApiContractTests bảo vệ các mã 201/204.

## Cách kiểm chứng

Chạy suite `dotnet test flower.com/tests/UnitTests/FlowerFlow.Backend.Tests -c Release`.
CompatibilityRegressionTests đối chiếu các ranh giới đã phát hiện từ source cũ;
integration tests kiểm tra pipeline HTTP thực, kiến trúc tests bảo vệ DTO/provider boundaries.
Chưa chứng nhận đầy đủ production parity; những phần còn thiếu nằm trong COMPATIBILITY-MATRIX.md.
