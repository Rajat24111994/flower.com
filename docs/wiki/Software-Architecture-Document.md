<div align="center">

# 🏛️ Kiến trúc phần mềm

**FlowerFlow được xây dựng từ những phần nào và chúng nối với nhau ra sao**

[🏠 Trang chủ](Home) · [📋 Yêu cầu chức năng](Functional-Requirements) · [⚡ Yêu cầu phi chức năng](Non‐Functional-Requirements)

</div>

---

## 1. Các thành phần

![Các thành phần hệ thống](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/thanh-phan.png)

| Thành phần | Nhiệm vụ |
| --- | --- |
| **Trang khách hàng** | Xem hoa, giỏ hàng, thanh toán, theo dõi đơn, đánh giá |
| **Trang quản trị** | Quản lý sản phẩm, đơn, ưu đãi, khu vực giao, báo cáo (`admin`); cấp quyền (`owner`) |
| **API đơn hàng** (`/api/orders`) | Báo giá, tạo đơn, giữ hàng, tự trả hàng khi đơn quá hạn |
| **API thanh toán** (`/api/payments`, `/api/vnpay-ipn`) | Tạo link VNPay và nhận kết quả thanh toán |
| **API khác** | Sản phẩm, khu vực giao, ảnh đánh giá, quản lý người dùng |
| **Firebase Authentication** | Đăng nhập bằng email hoặc Google |
| **Firestore** | Lưu toàn bộ dữ liệu cửa hàng |

## 2. Công nghệ

| Phần | Công nghệ |
| --- | --- |
| Giao diện | HTML, CSS, JavaScript thuần (không dùng framework) |
| Máy chủ | Vercel Serverless Functions (Node.js) |
| Dữ liệu | Firebase Firestore, Firebase Authentication |
| Thanh toán | VNPay |
| Kiểm thử | Node test runner, Firebase Emulator, Playwright |
| Tự động hóa | GitHub Actions (CI, sao lưu hằng ngày, smoke test) |

## 3. Dữ liệu

![Mô hình dữ liệu](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/du-lieu.png)

| Bảng (collection) | Lưu gì |
| --- | --- |
| `products` | Sản phẩm: tên, giá, ảnh, tồn kho, loài, màu, dịp |
| `orders` | Đơn hàng: sản phẩm, người nhận, giao hàng, thanh toán, lịch sử trạng thái |
| `paymentTransactions` | Các lần thanh toán VNPay của đơn |
| `reviews`, `reviewImages` | Đánh giá của khách và ảnh kèm theo |
| `metadata` | Danh mục, ưu đãi đang chạy, khu vực giao hàng |
| `adminRoles` | Ai có quyền quản lý |
| `orderRequests`, `orderLookupLimits` | Chống đặt trùng đơn và chống dò mã đơn |

## 4. Luồng chính

**Mua hàng:** khách chọn hoa → máy chủ báo giá → khách xác nhận → máy chủ kiểm tra lại và giữ hàng → tạo đơn.

![Luồng mua hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/luong-mua-hang.png)

**Trạng thái đơn hàng:**

![Vòng đời đơn hàng](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/vong-doi-don.png)

## 5. Bảo mật

- **Tiền do máy chủ tính:** giá, ưu đãi, phí giao đều tính lại ở máy chủ; số liệu từ trình duyệt không được tin.
- **Phân quyền 2 lớp:** API kiểm tra quyền, và Firestore Security Rules chặn truy cập trái phép.
- **Thanh toán:** kết quả VNPay phải có chữ ký hợp lệ mới được ghi nhận.
- **Không lộ thông tin khách:** tra cứu đơn bằng mã đơn chỉ hiện tiến độ, có giới hạn số lần thử.
- **Khóa bí mật:** lưu trong cài đặt của Vercel và GitHub, không nằm trong code.

## 6. Triển khai

![Quy trình triển khai](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/trien-khai.png)

1. Mỗi lần push code, GitHub Actions chạy 3 nhóm test: unit, emulator và trình duyệt.
2. Vercel tạo một bản xem thử riêng cho mỗi PR.
3. Khi test xanh và PR được gộp vào `main`, Vercel tự đưa bản mới lên web thật.
