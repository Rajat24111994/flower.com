# Rà soát PR #152 theo từng bước

## Bước 1: đối chiếu và sửa lỗi tương thích

Phạm vi: chỉ host in-memory mới. Không sửa backend JS, frontend, Firebase,
database hoặc cấu hình triển khai. Đối chiếu trực tiếp source đang có trong repo:

- `js/order/order-store.js`: cập nhật đơn vẫn chờ xác nhận phải giữ nguyên hạn giữ kho;
  chỉ đặt lại hạn khi khôi phục đơn đã giải phóng kho, xóa hạn khi rời trạng thái chờ.
- `backend/orders/validation.js`, `checkout.js`: validator trả về dữ liệu đã chuẩn hóa;
  khóa idempotency, lịch giao, mã ưu đãi/khu vực và các dòng hàng phải dùng giá trị đó.
- `backend/orders/pricing.js`: tổng nhu cầu được gộp theo productId chuẩn hóa, không theo
  chuỗi đầu vào có khoảng trắng.

Đã tái hiện năm lỗi bằng test trước khi sửa (5/5 test đỏ):

| Tình huống | Hành vi lỗi của bản mới | Hành vi sau sửa |
| --- | --- | --- |
| Cập nhật đơn chờ sang chính trạng thái chờ | Mất reservationExpiresAt, không tự hết hạn | Giữ nguyên hạn, không kéo dài 30 phút |
| Gửi lại key UUID có khoảng trắng | Tạo đơn thứ hai và giữ kho lần nữa | Dùng key đã trim, trả lại cùng đơn |
| Báo giá với ID/ưu đãi/khu vực được trim bởi validator | Vẫn tra bằng chuỗi thô, báo không tìm thấy | Tra bằng dữ liệu chuẩn hóa |
| Lịch giao hợp lệ nhưng có khoảng trắng | ValidateCheckout chấp nhận nhưng kiểm tra lịch sau đó từ chối | Dùng lịch đã chuẩn hóa xuyên suốt |
| Khách vãng lai có hai dòng cùng sản phẩm nhưng khác khoảng trắng | Không gộp đúng để kiểm tra giới hạn khách | Gộp productId chuẩn hóa, từ chối vượt 5 và không ghi kho |

Sau sửa, năm regression tests đều đạt. Validator không chỉ trả `true/false`:
nó trả một biểu diễn chuẩn để tránh mỗi lớp hiểu cùng dữ liệu theo cách khác.
Đó là lý do báo giá, fingerprint, idempotency và giữ kho phải dùng chung biểu diễn này.

## Bước 2: chốt hợp đồng hiện tại

Đã ghi rõ DTO/JSON, phân quyền, số tiền VND, version, idempotency, vòng đời giữ kho,
quyền riêng tư và mã HTTP trong API-CONTRACT.md. Không đổi URL/body/response đang
dùng của frontend; baseline này chỉ dành cho `/api/v1` trên host mới.

Phát hiện thêm OpenAPI mặc định ghi 200 cho các action thực tế trả 201/204.
Tám kiểm thử schema đã tái hiện vấn đề trước khi thêm ProducesResponseType;
khai báo status và DTO tường minh giúp Swagger phản ánh đúng hành vi HTTP.

## Bước 3: kiểm thử xuyên suốt HTTP

Đã thêm CheckoutWorkflowTests dùng WebApplicationFactory và TimeProvider giả lập,
không chờ thật 15/30 phút và không kết nối database. Các luồng mới:

1. Báo giá với ID/ưu đãi/khu vực có khoảng trắng → checkout → gửi lại với cùng key
   đã trim: nhận cùng đơn, cùng tổng, kho chỉ giảm một lần.
2. Cập nhật đơn đang chờ xác nhận sau 10 phút → deadline không đổi → quá hạn →
   cleanup hai lần: chỉ lần đầu hoàn kho.
3. Thanh toán thất bại → hết hạn → retry giữ kho lại → thành công → gửi kết quả
   thành công trùng → tiền đến thêm từ attempt cũ: không trừ/hoàn kho lặp và có cảnh báo đối soát.

Suite còn giữ luồng HTTP đặt hàng → đối soát QR → chuẩn bị → giao → đánh giá →
kiểm duyệt công khai, cùng các kiểm thử chống oversell, sai giá và quyền sở hữu.

Kết quả local sau bước 3: 58/58 tests đạt; build toàn solution Release 0 lỗi,
0 cảnh báo. Các bước được commit/push riêng lên nhánh PR #152; chưa merge main.
Đề xuất cho giai đoạn lưu trữ bền nằm trong NEXT-STAGE.md, chưa thực hiện SQL/EF.

## Giới hạn

Các source cũ chỉ được đọc làm căn cứ. Chưa kết nối SQL/EF, chưa dùng gateway thật,
chưa triển khai danh tính thật và chưa chuyển production sang host mới.
Các chức năng chưa đối chiếu hết tiếp tục được theo dõi trong COMPATIBILITY-MATRIX.md;
không coi đợt rà soát này là chứng nhận toàn bộ parity production.
