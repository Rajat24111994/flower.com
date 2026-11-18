<div align="center">

# 📋 Yêu cầu chức năng

**Những gì FlowerFlow làm được cho khách hàng và cho cửa hàng**

[🏠 Trang chủ](Home.md) · [⚡ Yêu cầu phi chức năng](Non-Functional-Requirements.md) · [🏛️ Kiến trúc phần mềm](Software-Architecture-Document.md)

</div>

---

Đối chiếu 18/11/2026: website dùng C# trên Render tại <https://flower-com.onrender.com>; các dấu ✅ dưới đây chỉ tình trạng chức năng trong code/test. VNPay đã tắt từ 17/11/2026 (commit `25ca5ba`), thanh toán online chỉ còn chuyển khoản VietQR. Xem [SAD](Software-Architecture-Document.md) và [mốc bằng chứng mới](Traceability-Matrix.md).

## 🛍️ Chức năng cho khách hàng

Xem [ma trận truy vết KH/QT/NF](Traceability-Matrix.md) để đối chiếu từng yêu cầu với user story, issue, mã nguồn, test và kết quả CI. Trạng thái có chức năng không thay thế bằng chứng nghiệm thu môi trường thật.

![Chức năng cho khách hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/chuc-nang-khach-hang.png)

| Mã | Chức năng | Mô tả | Trạng thái |
| --- | --- | --- | :---: |
| KH‑01 | Tài khoản | Đăng ký, đăng nhập bằng email/mật khẩu hoặc Google, quên mật khẩu. Mật khẩu mới ≥ 8 ký tự, có chữ thường và số | ✅ |
| KH‑02 | Danh sách hoa | Xem ảnh, tên, giá (VND, đã gồm VAT) và số lượng còn hàng | ✅ |
| KH‑03 | Tìm kiếm và lọc | Tìm theo tên (gõ không dấu hoặc tiếng Anh như "rose" vẫn ra), lọc theo loài, giá, màu, dịp tặng; sắp xếp theo giá hoặc bán chạy. Bộ lọc được giữ khi tải lại trang | ✅ |
| KH‑04 | Chi tiết sản phẩm | Ảnh, mô tả, đánh giá đã duyệt và sản phẩm liên quan | ✅ |
| KH‑05 | Tùy chọn bó hoa | Chọn kích cỡ, màu hoa và lời nhắn trên thiệp | ✅ |
| KH‑06 | Giỏ hàng | Thêm, bớt, xóa; không vượt quá tồn kho và tối đa 50 bó mỗi loại. Mỗi tài khoản có giỏ riêng, đăng xuất không mất giỏ | ✅ |
| KH‑07 | Yêu thích | Lưu những bó hoa muốn mua sau | ✅ |
| KH‑08 | Đặt hàng | Nhập người nhận, khu vực giao (tỉnh, quận), ngày và khung giờ giao, lời chúc, gói quà, ghi chú. Chỉ giao nội thành Hà Nội (12 quận), phí 5.000 VND/km từ Hà Đông. Đơn giao trong ngày phải đặt trước 15:00. Ưu đãi tốt nhất được tự áp dụng. Trang xác nhận có nút ✕ để bỏ đơn đang đặt | ✅ |
| KH‑09 | Thanh toán | Trả tiền khi nhận hàng (COD) hoặc chuyển khoản VietQR Vietcombank; cửa hàng đối chiếu và xác nhận tiền. COD giữ hàng 5 phút chờ xác nhận, QR giữ 30 phút chờ chuyển khoản | ✅ |
| KH‑10 | Theo dõi đơn | Tra đơn bằng mã đơn và số điện thoại; xem 4 bước: Chờ xác nhận → Đang chuẩn bị → Đang giao → Hoàn thành. Khách đã đăng nhập xem được mọi đơn của mình | ✅ |
| KH‑11 | Đánh giá | Sau khi nhận hoa, chấm 1–5 sao, viết nhận xét và đăng ảnh; đánh giá hiện lên sau khi cửa hàng duyệt | ✅ |
| KH‑12 | Liên hệ | Nút Facebook, Zalo; trang giới thiệu, câu hỏi thường gặp và các chính sách | ✅ |

## 🧑‍💼 Chức năng cho quản trị

![Chức năng cho quản trị](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/chuc-nang-quan-tri.png)

| Mã | Chức năng | Mô tả | Trạng thái |
| --- | --- | --- | :---: |
| QT‑01 | Sản phẩm | Thêm, sửa, ẩn, xóa sản phẩm; cập nhật ảnh và tồn kho. Dữ liệu sai được báo ngay trên form | ✅ |
| QT‑02 | Danh mục | Thêm, sửa các loại hoa và dịp tặng | ✅ |
| QT‑03 | Ưu đãi | Tạo chương trình giảm giá theo phần trăm cho từng sản phẩm | ✅ |
| QT‑04 | Khu vực giao | Cài đặt tỉnh, quận được giao và phí giao từng nơi; khi chưa lưu gì, hệ thống dùng sẵn 12 quận nội thành Hà Nội tính 5.000 VND/km | ✅ |
| QT‑05 | Đơn hàng | Xác nhận, chuyển trạng thái, hủy đơn; hủy thì hàng tự trả về kho | ✅ |
| QT‑06 | Thanh toán | Xem đơn trả bằng gì (COD hay chuyển khoản QR) và đã trả tiền chưa; đối chiếu sao kê, nhập mã giao dịch và xác nhận tiền | ✅ |
| QT‑07 | Báo cáo | Doanh thu theo ngày, tháng hoặc khoảng ngày tùy chọn; tồn kho; xuất ra Excel | ✅ |
| QT‑08 | Đánh giá | Duyệt, ẩn và trả lời đánh giá của khách | ✅ |
| QT‑09 | Lời nhắn | Xem và trả lời lời nhắn khách gửi kèm đơn | ✅ |
| QT‑10 | Người dùng | Quản lý xem danh sách tài khoản; chủ cửa hàng cấp hoặc thu hồi quyền quản lý | ✅ |
| QT‑11 | Sao lưu | Tự sao lưu dữ liệu mỗi ngày và khôi phục khi có sự cố. Đã cấu hình secret và chạy thật thành công 17/11/2026; còn chờ bằng chứng chạy theo lịch (#118) | ⚠️ |

> ✅ Đã có và đã kiểm thử · ⚠️ Đã chạy được nhưng còn thiếu bằng chứng nghiệm thu (xem [Yêu cầu phi chức năng](Non-Functional-Requirements.md)) · ❌ Chưa có

## 💳 Thanh toán

Thanh toán online hiện là **chuyển khoản VietQR Vietcombank**, không qua cổng thanh toán.

- Số tiền do máy chủ tính, khách không sửa được; trang theo dõi đơn hiện mã QR đúng số tiền và nội dung chuyển khoản.
- Đơn chỉ được coi là **đã thanh toán** khi admin đối chiếu sao kê, nhập mã giao dịch ngân hàng và xác nhận; thao tác được ghi vào `orderPaymentAudit`.
- Quá 30 phút chưa nhận được tiền, đơn tự hủy và trả hàng về kho. Tiền đến sau khi đơn đã hủy được xử lý bằng thao tác riêng (khôi phục hoặc hoàn tiền).
- VNPay từng được tích hợp (URL ký HMAC, IPN) nhưng đã tắt từ 17/11/2026; `/api/payments` và `/api/vnpay-ipn` trả 410. Nếu bật lại cần merchant sandbox và kiểm thử IPN thật trước.
