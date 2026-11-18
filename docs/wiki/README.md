# Ảnh và nội dung cho GitHub Wiki

Thư mục này chứa nguồn cho [wiki của dự án](https://github.com/Longg5048/flower.com/wiki).
Đã đối chiếu kiến trúc C#/Render và Firestore ngày 17/11/2026 (#167); cập nhật thanh toán (VNPay tắt, VietQR), giữ hàng COD 5 phút, sao lưu, mật khẩu và Lighthouse ngày 18/11/2026.

## Cách cập nhật một trang wiki

1. Mở file `.md` tương ứng ở bảng dưới, bấm nút **Copy raw file** (2 ô vuông chồng nhau).
2. Mở trang đó trên wiki → **Edit** → **Ctrl + A** → **Ctrl + V** → **Save page**.

| File | Trang wiki |
| --- | --- |
| `Home.md` | Home |
| `Functional-Requirements.md` | Functional Requirements |
| `Non-Functional-Requirements.md` | Non‐Functional Requirements |
| `Software-Architecture-Document.md` | Software Architecture Document |
| `Traceability-Matrix.md` | Traceability Matrix |
| `Data-Model.md` | Data Model — Firestore hiện tại, SQL chỉ đề xuất |

Ma trận truy vết ghi ngày đối chiếu, commit và link CI cụ thể; cập nhật các thông tin này khi thay bằng chứng kiểm thử. Các thay đổi file trong repository không tự đồng bộ sang GitHub Wiki.

Khi đồng bộ qua Git: clone `https://github.com/Longg5048/flower.com.wiki.git`,
đọc diff trước khi chép sáu trang nguồn, commit và push repository Wiki riêng.
Trang NFR trên Wiki hiện dùng tên `Non‐Functional-Requirements.md` (U+2010);
file nguồn dùng `Non-Functional-Requirements.md` (dấu ASCII). Ánh xạ đúng tên
và chuyển link tương đối `.md` sang slug Wiki; không ghi đè trang khác chưa đọc.
Kiểm tra nội dung remote bằng SHA/blob sau push. Commit main không tự xuất bản Wiki.

## Ảnh

SAD, Data Model và các sơ đồ kiến trúc/backup mới dùng Mermaid trực tiếp trong Markdown.
PNG bên dưới là tài sản lịch sử còn giữ để không phá liên kết cũ; không dùng chúng
để khẳng định kiến trúc Node/Vercel hoặc trạng thái vận hành hiện tại.

| Ảnh | Nội dung | Dùng ở trang |
| --- | --- | --- |
| `kien-truc.png` | Kiến trúc tổng quan | Home |
| `luong-mua-hang.png` | 5 bước mua hàng | Home, Kiến trúc |
| `vong-doi-don.png` | Trạng thái đơn hàng | Home, Kiến trúc |
| `chuc-nang-khach-hang.png` | Nhóm chức năng khách hàng | Yêu cầu chức năng |
| `chuc-nang-quan-tri.png` | Nhóm chức năng quản trị | Yêu cầu chức năng |
| `thanh-toan-vnpay.png` | Luồng thanh toán VNPay | Yêu cầu chức năng |
| `sao-luu.png` | Sao lưu và khôi phục | Yêu cầu phi chức năng |
| `thanh-phan.png` | Các thành phần hệ thống | Kiến trúc |
| `du-lieu.png` | Mô hình dữ liệu Firestore | Kiến trúc |
| `trien-khai.png` | Quy trình kiểm thử và triển khai | Kiến trúc |

Wiki hiện ảnh bằng đường dẫn `https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/<tên-file>.png`, nên **không đổi tên hay xóa** các file ảnh. Muốn thay ảnh thì ghi đè file cùng tên.
