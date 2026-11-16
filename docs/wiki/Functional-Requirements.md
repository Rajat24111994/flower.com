<div align="center">

# 📋 Yêu cầu chức năng

**Những gì FlowerFlow làm được cho khách hàng và cho cửa hàng**

[🏠 Trang chủ](Home) · [⚡ Yêu cầu phi chức năng](Non‐Functional-Requirements) · [🏛️ Kiến trúc phần mềm](Software-Architecture-Document)

</div>

---

## 🛍️ Chức năng cho khách hàng

Xem [ma trận truy vết KH/QT/NF](Traceability-Matrix.md) để đối chiếu từng yêu cầu với user story, issue, mã nguồn, test và kết quả CI. Trạng thái có chức năng không thay thế bằng chứng nghiệm thu môi trường thật.

![Chức năng cho khách hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/chuc-nang-khach-hang.png)

| Mã | Chức năng | Mô tả | Trạng thái |
| --- | --- | --- | :---: |
| KH‑01 | Tài khoản | Đăng ký, đăng nhập bằng email/mật khẩu hoặc Google, quên mật khẩu | ✅ |
| KH‑02 | Danh sách hoa | Xem ảnh, tên, giá (VND, đã gồm VAT) và số lượng còn hàng | ✅ |
| KH‑03 | Tìm kiếm và lọc | Tìm theo tên (gõ không dấu hoặc tiếng Anh như "rose" vẫn ra), lọc theo loài, giá, màu, dịp tặng; sắp xếp theo giá hoặc bán chạy. Bộ lọc được giữ khi tải lại trang | ✅ |
| KH‑04 | Chi tiết sản phẩm | Ảnh, mô tả, đánh giá đã duyệt và sản phẩm liên quan | ✅ |
| KH‑05 | Tùy chọn bó hoa | Chọn kích cỡ, màu hoa và lời nhắn trên thiệp | ✅ |
| KH‑06 | Giỏ hàng | Thêm, bớt, xóa; không vượt quá tồn kho và tối đa 50 bó mỗi loại. Mỗi tài khoản có giỏ riêng, đăng xuất không mất giỏ | ✅ |
| KH‑07 | Yêu thích | Lưu những bó hoa muốn mua sau | ✅ |
| KH‑08 | Đặt hàng | Nhập người nhận, khu vực giao (tỉnh, quận), ngày và khung giờ giao, lời chúc, gói quà, ghi chú. Đơn giao trong ngày phải đặt trước 15:00. Ưu đãi tốt nhất được tự áp dụng | ✅ |
| KH‑09 | Thanh toán | Trả tiền khi nhận hàng (COD) hoặc thanh toán online qua VNPay | ✅ |
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
| QT‑04 | Khu vực giao | Cài đặt tỉnh, quận được giao và phí giao từng nơi | ✅ |
| QT‑05 | Đơn hàng | Xác nhận, chuyển trạng thái, hủy đơn; hủy thì hàng tự trả về kho | ✅ |
| QT‑06 | Thanh toán | Xem đơn trả bằng gì (COD hay VNPay) và đã trả tiền chưa | ✅ |
| QT‑07 | Báo cáo | Doanh thu theo ngày, tháng hoặc khoảng ngày tùy chọn; tồn kho; xuất ra Excel | ✅ |
| QT‑08 | Đánh giá | Duyệt, ẩn và trả lời đánh giá của khách | ✅ |
| QT‑09 | Lời nhắn | Xem và trả lời lời nhắn khách gửi kèm đơn | ✅ |
| QT‑10 | Người dùng | Quản lý xem danh sách tài khoản; chủ cửa hàng cấp hoặc thu hồi quyền quản lý | ✅ |
| QT‑11 | Sao lưu | Tự sao lưu dữ liệu mỗi ngày và khôi phục khi có sự cố | ⚠️ |

> ✅ Đã có và đã kiểm thử · ⚠️ Đã có code, cần cài thêm trên GitHub để chạy (xem [Yêu cầu phi chức năng](Non‐Functional-Requirements)) · ❌ Chưa có

## 💳 Thanh toán VNPay

![Luồng thanh toán VNPay](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/thanh-toan-vnpay.png)

- Số tiền do máy chủ tính, khách không sửa được.
- Đơn chỉ được coi là **đã thanh toán** khi VNPay gửi kết quả có chữ ký hợp lệ về máy chủ.
- Muốn chạy thật, cửa hàng cần đăng ký tài khoản VNPay và cài mã vào Vercel.
