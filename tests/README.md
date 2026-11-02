# Hướng dẫn kiểm thử

## Yêu cầu

- Node.js 24.x (kiểm tra bằng `node --version`).
- Unit test không cần cài thư viện riêng; các test dùng `node:assert` và Node.js Test Runner.
- Test tích hợp (feature, system, security) cần thêm Java 11+ cho Firebase Emulator và `npm ci` trong thư mục `tests`.

## Chạy kiểm thử

| Loại | Lệnh | Nội dung |
|---|---|---|
| Unit test | `cd flower.com && npm test` | Tính giá, ưu đãi, dữ liệu đơn hàng, trạng thái đơn, giỏ hàng, danh mục, sản phẩm |
| Unit test + coverage | `cd flower.com && npm run test:coverage` | Như trên, kèm tỉ lệ dòng/nhánh/hàm được test |
| Feature, system, security | `cd tests && npm ci && npm run integration` | Đặt hàng, đăng nhập, quản lý, luồng xuyên hệ thống, Firestore rules và quyền API |
| Smoke test sau khi deploy | `cd flower.com && SMOKE_URL=https://... npm run smoke` | Trang và API còn chạy, không tạo đơn, không đổi dữ liệu |

Trên Windows, nếu PowerShell chặn `npm` (execution policy), dùng `npm.cmd` thay cho `npm`.

Để chạy một file test, dùng Node.js Test Runner từ thư mục `flower.com`:

```sh
node --test ../tests/product-page.test.js
```

Test tích hợp chạy API thật (`flower.com/api/*.js`) và `firestore.rules` thật trên **Firebase Emulator** với project `demo-flowerflow`, nên không đụng tới dữ liệu thật. CI trên GitHub Actions chạy cả unit test và test tích hợp cho mọi Pull Request.

## Các phạm vi đang được kiểm thử

| File | Phạm vi |
| --- | --- |
| `product-page.test.js` | Hiển thị và tương tác trang sản phẩm |
| `product-related.test.js` | Gợi ý sản phẩm liên quan, loại bỏ trùng lặp |
| `product-categories.test.js` | Phân loại sản phẩm theo danh mục |
| `product-store-sync.test.js` | Gộp catalog từ Firestore với dữ liệu mặc định |
| `shopping-store.test.js` | Giỏ hàng, yêu thích, giới hạn tồn kho |
| `store-footer.test.js` | Footer dùng chung |
| `order-pricing.test.js` | Tính giá, ưu đãi, làm tròn VND, giá trình duyệt khớp giá máy chủ |
| `order-validation.test.js` | Dữ liệu đơn hàng hợp lệ/không hợp lệ, tra cứu công khai không lộ thông tin |
| `order-status.test.js` | Trạng thái đơn và trạng thái cũ |
| `integration/feature-orders.test.js` | Báo giá, tạo đơn, trừ kho, chống đặt trùng, ưu đãi, đơn hết hạn, tra cứu |
| `integration/feature-accounts.test.js` | Đơn gắn tài khoản, token giả/thu hồi, đánh giá của chủ đơn |
| `integration/feature-admin.test.js` | API quản trị: danh sách tài khoản, cấp/thu quyền, khôi phục sản phẩm |
| `integration/system.test.js` | Đặt hàng → admin giao → khách theo dõi, đánh giá → trang sản phẩm |
| `integration/security-rules.test.js` | Firestore Security Rules cho từng loại dữ liệu |
| `integration/security-api.test.js` | API khi thiếu/sai xác thực hoặc không đủ quyền |

Mỗi tính năng mới viết test trước (xem `CONTRIBUTING.md`).

## Báo cáo kết quả

Sau mỗi đợt chạy test, sao chép `docs/test-reports/TEMPLATE.md` thành `docs/test-reports/YYYY-MM-DD.md` (nếu cùng ngày đã có báo cáo, thêm hậu tố như `-ci` hoặc `-2`). Ghi lại commit/nhánh nếu biết, môi trường, từng lệnh đã chạy, kết quả đạt/trượt, thông báo lỗi và các bước tái hiện tối thiểu. Nếu không có test nào trượt, ghi rõ `Không có` ở mục lỗi và tái hiện. Không đưa token, mật khẩu, thông tin khách hàng hoặc bí mật môi trường vào báo cáo.

Khi một test thất bại, giữ nguyên đầu ra lỗi liên quan, xác định test/file bị ảnh hưởng và mô tả các bước cần thiết để chạy lại. Không đánh dấu đợt kiểm thử là đạt nếu có test bị bỏ qua hoặc không chạy; hãy nêu rõ trạng thái thực tế.

## Kiểm thử giao diện trên trình duyệt

Các kịch bản Playwright nằm trong `flower.com/e2e/`. Chúng chạy trên Firebase Auth và Firestore Emulator, đồng thời mock API tạo đơn để kiểm thử không ghi dữ liệu lên cửa hàng thật. Cài Java 21 và Chromium cho Playwright, sau đó chạy:

```sh
cd flower.com
npm ci
npx playwright install chromium
npm run test:e2e:emulator
```

Kịch bản mua hàng chạy ở 1280×800 và 390×844, chụp ảnh tại từng bước và đánh trượt nếu có lỗi console hoặc request bị lỗi. Ảnh, trace khi thất bại và báo cáo HTML được lưu trong `test-results/` và `flower.com/playwright-report/`. CI chạy các kịch bản này cùng Firebase Emulator và lưu artifact của lần chạy.
