<div align="center">

# 🌸 FlowerFlow

**Website bán hoa tươi trực tuyến kèm hệ thống quản lý cửa hàng**

![Vercel](https://img.shields.io/badge/Hosting-Vercel-111111?logo=vercel&logoColor=white)
![Firebase](https://img.shields.io/badge/Dữ_liệu-Firebase-111111?logo=firebase&logoColor=white)
![JavaScript](https://img.shields.io/badge/Code-JavaScript-111111?logo=javascript&logoColor=white)
![Tests](https://img.shields.io/badge/Kiểm_thử-Unit_·_Emulator_·_Playwright-111111)

[Yêu cầu chức năng](Functional-Requirements) · [Yêu cầu phi chức năng](Non‐Functional-Requirements) · [Kiến trúc phần mềm](Software-Architecture-Document)

</div>

---

## 📌 Tầm nhìn sản phẩm

FlowerFlow giúp khách hàng **tìm, chọn và đặt hoa trong vài phút**, đồng thời giúp chủ cửa hàng **quản lý sản phẩm, tồn kho, đơn hàng và doanh thu** ở cùng một nơi.

| 🛍️ Khách hàng | 🧑‍💼 Nhân viên quản lý | 👑 Chủ cửa hàng |
| --- | --- | --- |
| Tìm và lọc hoa theo loài, dịp, màu, giá | Xác nhận và cập nhật trạng thái đơn | Toàn quyền nhân viên quản lý |
| Tùy chọn bó hoa, thiệp, gói quà | Quản lý sản phẩm, tồn kho, danh mục | Cấp và thu hồi quyền quản lý |
| Thanh toán COD hoặc VNPay | Duyệt đánh giá, trả lời lời nhắn | Xuất báo cáo doanh thu ra Excel |
| Theo dõi đơn, đánh giá kèm ảnh | Theo dõi thanh toán, xem báo cáo doanh thu | |

## 🎯 Mục tiêu chính

1. **Mua hoa nhanh và thuận tiện**: từ lúc chọn hoa đến khi đặt xong chỉ qua 3 bước (giỏ hàng → thanh toán → xác nhận).
2. **Không bán vượt tồn kho**: kho được giữ chỗ ngay khi đặt đơn và tự trả lại nếu đơn quá hạn.
3. **Giá và thanh toán chính xác**: mọi khoản tiền đều do máy chủ tính lại, không tin số liệu từ trình duyệt.
4. **Giảm thao tác thủ công** cho cửa hàng nhờ trang quản trị và báo cáo tự động.

## 🏗️ Kiến trúc tổng quan

![Kiến trúc tổng quan](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/kien-truc.png)

## 🛒 Luồng mua hàng

![Luồng mua hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/luong-mua-hang.png)

## 📦 Vòng đời đơn hàng

![Vòng đời đơn hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/vong-doi-don.png)

> ⏱️ **Thời gian giữ hàng khi chưa thanh toán:** VNPay 15 phút · COD 24 giờ. Quá hạn, hàng tự trả lại kho.

## 🧭 Phạm vi

| Hạng mục | Nội dung |
| --- | --- |
| **Người dùng** | Khách mua hoa, nhân viên quản lý, chủ cửa hàng |
| **Nền tảng** | Website (máy tính và điện thoại) + trang quản trị |
| **Chức năng cốt lõi** | Danh mục và tìm kiếm, giỏ hàng, đặt hàng, thanh toán, theo dõi đơn, đánh giá |
| **Quản trị** | Sản phẩm, tồn kho, danh mục, ưu đãi, khu vực giao, đơn hàng, doanh thu, người dùng |
| **Ngoài phạm vi** | Nhiều chi nhánh, ứng dụng di động riêng, thanh toán thẻ tín dụng trực tiếp |

## 📚 Tài liệu liên quan

| Trang | Nội dung |
| --- | --- |
| 📋 [Yêu cầu chức năng](Functional-Requirements) | Danh sách chức năng cho khách hàng và quản trị |
| ⚡ [Yêu cầu phi chức năng](Non‐Functional-Requirements) | Hiệu năng, bảo mật, sao lưu, kiểm thử |
| 🏛️ [Kiến trúc phần mềm](Software-Architecture-Document) | Thành phần hệ thống, dữ liệu, triển khai |
