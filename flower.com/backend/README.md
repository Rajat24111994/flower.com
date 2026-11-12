# Backend FlowerFlow

Backend chạy dưới dạng **Vercel Functions** (Node.js), dữ liệu ở **Cloud Firestore**, đăng nhập bằng **Firebase Authentication**. Code chia thành từng **module theo nghiệp vụ**; mỗi module tự chứa phần xử lý của nó.

## Cách tổ chức

```text
flower.com/
├── api/                  # Điểm vào của Vercel: mỗi file là một URL /api/..., chỉ 1 dòng trỏ sang backend/
└── backend/
    ├── orders/           # Đơn hàng
    ├── payments/         # Thanh toán VNPay
    ├── catalog/          # Sản phẩm, ảnh, giá hoa
    ├── shop-settings/    # Khu vực giao hàng, phí gói bó
    ├── design-requests/  # Yêu cầu thiết kế bó hoa riêng
    ├── accounts/         # Đăng nhập
    ├── admin/            # Tài khoản, cấp quyền, nhật ký quản trị
    └── shared/           # Dùng chung cho mọi module
```

`api/` phải giữ nguyên vì Vercel lấy đường dẫn URL từ tên file trong thư mục này. Mỗi file `.js` trong `api/` là một hàm Vercel. Gói Hobby cho tối đa **12 hàm**, hiện dùng **11**. Mọi xử lý thật nằm trong `backend/`.

## URL → module

| URL | Điểm vào | Xử lý |
| --- | --- | --- |
| `/api/orders` | `api/orders.js` | `backend/orders/controller.js` |
| `/api/payments` | `api/payments.js` | `backend/payments/payments.js` |
| `/api/vnpay-ipn` | `api/vnpay-ipn.js` | `backend/payments/vnpay-ipn.js` |
| `/api/products` | `api/products.js` | `backend/catalog/products.js` |
| `/api/flower-prices` (rewrite) | `api/products.js?route=flower-prices` | `backend/catalog/flower-prices.js` |
| `/api/product-images` | `api/product-images.js` | `backend/catalog/product-images.js` |
| `/api/review-images` | `api/review-images.js` | `backend/catalog/review-images.js` |
| `/api/delivery-zones` | `api/delivery-zones.js` | `backend/shop-settings/delivery-zones.js` |
| `/api/bouquet-wrapping` (rewrite) | `api/delivery-zones.js?route=bouquet-wrapping` | `backend/shop-settings/bouquet-wrapping.js` |
| `/api/design-requests` | `api/design-requests.js` | `backend/design-requests/controller.js` |
| `/api/login` | `api/login.js` | `backend/accounts/login.js` |
| `/api/admin/users` | `api/admin/users.js` | `backend/admin/users.js` |
| `/api/admin/audit` (rewrite) | `api/admin/users.js?route=audit` | `backend/admin/audit.js` |
| `/api/owner/users` | `api/owner/users.js` | `backend/admin/owner-users.js` |

Rewrite khai báo trong `vercel.json`. Máy chủ chạy trên máy (`npm run dev`) áp dụng cùng các rewrite này.

## Từng module

### `orders/` — đơn hàng
Module lớn nhất, chia theo vai trò:

| File | Vai trò |
| --- | --- |
| `controller.js` | Nhận request `/api/orders`, chọn service theo `action` |
| `config.js` | Hằng số: tối đa 50 sản phẩm/loại; giữ hàng VNPay 15 phút, COD 30 phút; khung giờ giao |
| `validation.js` | Kiểm tra số điện thoại, ngày giờ giao, giỏ hàng, dữ liệu đặt hàng |
| `pricing.js` | Tính tiền phía máy chủ: giá, ưu đãi, phí giao theo khu vực, phí gói bó tự chọn |
| `checkout.js` | Báo giá và tạo đơn: tính lại giá, kiểm tra kho, giữ hàng trong transaction, chống đặt trùng, giới hạn tạo đơn |
| `reservations.js` | Hủy đơn quá hạn giữ hàng và hoàn kho (cron hoặc admin gọi `action=expire`) |
| `tracking.js` | Tra cứu đơn công khai (mã đơn + số điện thoại, 20 lượt/10 phút/IP) và đơn của tài khoản |
| `payment-admin.js` | Admin đối soát chuyển khoản QR, ghi nhận tiền đến trễ, hoàn tiền, xem nhật ký thanh toán |
| `reviews.js` | Đánh giá theo đơn: chỉ chủ đơn đã giao, mỗi đơn một đánh giá |

### `payments/` — VNPay
`payments.js` tạo link thanh toán và trả trạng thái; `vnpay-ipn.js` nhận kết quả có chữ ký từ VNPay; `vnpay.js` ký và kiểm chữ ký HMAC-SHA512. Dùng `orders/reservations.js` và `orders/pricing.js` để hoàn kho khi giao dịch hết hạn.

### `catalog/` — sản phẩm
`products.js` (danh sách công khai, bản quản lý cho admin, sửa tên lỗi dấu và ảnh cũ), `flower-prices.js` (chỉ Owner: giá hoa theo cành và lịch sử), `product-images.js`, `review-images.js` (lưu và trả ảnh), `image-rules.js` (quy tắc kiểm tra ảnh dùng chung).

### `shop-settings/` — cấu hình cửa hàng
`delivery-zones.js` (tỉnh/quận được giao và phí), `bouquet-wrapping.js` (phí gói bó theo số cành).

### `design-requests/` — thiết kế bó hoa riêng
`controller.js` (khách gửi yêu cầu, xem và phản hồi báo giá; admin gửi báo giá), `validation.js` (lựa chọn thiết kế, màu, cành hoa, ảnh tham khảo, mã truy cập).

### `accounts/` — đăng nhập
`login.js` (API đăng nhập), `login-protection.js` (khóa sau nhiều lần sai, tăng dần thời gian khóa), `password-auth.js` (kiểm tra mật khẩu qua Firebase).

### `admin/` — quản trị
`users.js` (danh sách tài khoản), `owner-users.js` (Owner cấp/gỡ quyền admin), `audit.js` (đọc nhật ký quản trị), `roles.js` (đồng bộ bảng `adminRoles` với custom claims, dùng cả trong các script quản trị).

### `shared/` — dùng chung
`firebase-admin.js` (kết nối Firebase, `sendError`, kiểm tra token và quyền admin/owner), `request-identity.js` (khách đang gọi là ai), `admin-audit.js` (ghi nhật ký thao tác quản trị), `api-routes.js` (`withRoutes`: gộp nhiều API vào một hàm Vercel theo `?route=`).

## Quy tắc phụ thuộc

- Module chỉ `require` từ `shared/`, từ chính nó, hoặc service của module khác khi thật sự dùng chung quy tắc. Ví dụ `payments` và `design-requests` dùng `orders/pricing.js` và `orders/validation.js`.
- Không module nào `require` từ `api/`.
- Mã chỉ dùng khi chạy trên máy (máy chủ dev, tài khoản SQLite, PIN) nằm trong `lib/`, không chạy trên Vercel.

## Thêm một API mới

1. Viết handler trong module phù hợp ở `backend/<module>/`.
2. Nếu cần URL riêng mà không muốn thêm hàm Vercel: đăng ký vào hàm có sẵn bằng `withRoutes` (`shared/api-routes.js`), rồi thêm `rewrites` trong `vercel.json`.
3. Chỉ tạo file mới trong `api/` khi còn chỗ trong giới hạn 12 hàm. `tests/vercel-functions.test.js` báo đỏ nếu vượt.
4. Viết test: unit với Firestore giả (`tests/helpers/fake-firestore.js`) và test tích hợp trên Firebase Emulator (`tests/integration/`).
