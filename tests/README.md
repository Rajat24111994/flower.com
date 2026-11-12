# Hướng dẫn kiểm thử

## Yêu cầu

- Node.js 24.x (kiểm tra bằng `node --version`).
- Unit test không cần cài thư viện riêng; các test dùng `node:assert` và Node.js Test Runner.
- Test tích hợp (feature, system, security) cần thêm Java 11+ cho Firebase Emulator và `npm ci` trong thư mục `tests`.

## Chạy kiểm thử

| Loại | Lệnh | Nội dung |
|---|---|---|
| Unit test | `cd flower.com && npm test` | Tính giá, ưu đãi, dữ liệu đơn hàng, trạng thái đơn, giỏ hàng, danh mục, sản phẩm |
| Unit test + coverage | `cd flower.com && npm run test:coverage` | Như trên, kèm tỉ lệ dòng/nhánh/hàm; CI yêu cầu tối thiểu 70% coverage dòng. 12 module giao diện admin (`js/admin/admin-{state,data,…,events}.js`) không tính vào coverage unit vì chạy trong trình duyệt và được kiểm tra bằng e2e `admin-*.spec.js` |
| Feature, system, security | `cd tests && npm ci && npm run integration` | Đặt hàng, đăng nhập, quản lý, luồng xuyên hệ thống, Firestore rules và quyền API |
| Kiểm thử tải (emulator) | `cd tests && npm ci && npm run load` | Xem danh mục, báo giá và nhiều khách tranh mua hàng cuối; in p50/p95/p99, tỉ lệ lỗi, kiểm tra không bán vượt kho. Chỉnh bằng `LOAD_DURATION`, `LOAD_CONCURRENCY`, `LOAD_BUYERS`, `LOAD_STOCK` |
| Smoke test sau khi deploy | `cd flower.com && SMOKE_URL=https://... npm run smoke` | Trang và API còn chạy, không tạo đơn, không đổi dữ liệu |

Trên Windows, nếu PowerShell chặn `npm` (execution policy), dùng `npm.cmd` thay cho `npm`.

Để chạy một file test, dùng Node.js Test Runner từ thư mục `flower.com`:

```sh
node --test ../tests/product-page.test.js
```

Test tích hợp chạy API thật (`flower.com/api/*.js`) và `firestore.rules` thật trên **Firebase Emulator** với project `demo-flowerflow`, nên không đụng tới dữ liệu thật. CI trên GitHub Actions chạy cả unit test và test tích hợp cho mọi Pull Request.

## Các phạm vi đang được kiểm thử

### Coverage các module rủi ro cao (#125)

Job **Critical module coverage** tải artifact unit và integration trong cùng lần CI, rồi kiểm tra các module rủi ro cao được #125 nêu: `backend/shop-settings/delivery-zones.js`, từng file của module đơn hàng `backend/orders/` (checkout, reservations, tracking, payment-admin, reviews, pricing, validation, controller), `backend/design-requests/` (controller, validation), `js/catalog/product-store.js`, `backend/shared/firebase-admin.js`, `js/review/review-images.js`. Danh sách nằm trong `tests/coverage-targets.js`. Mỗi module cần ít nhất **50% dòng trong unit hoặc integration**. Chọn kết quả tốt hơn của hai bộ; không cộng phần trăm hoặc cộng số dòng đã chạy giữa các báo cáo. Thiếu module/báo cáo hoặc dữ liệu LCOV lỗi làm gate thất bại.

Sau khi tạo cả hai báo cáo, chạy từ gốc repository:

```sh
node tests/coverage-targets.js flower.com/coverage/lcov.info tests/coverage/lcov.info --min-lines=50
```

Các test `firebase-admin.test.js`, `delivery-zones-api.test.js`, `design-requests-api.test.js` dùng module thật với dependency được cô lập để đưa lỗi cấu hình, xác thực và dịch vụ vào đúng nhánh xử lý. Fixture transaction trong `helpers/api-fixture.js` không mô phỏng Security Rules hay tính đồng thời của Firestore; các tính chất đó vẫn được kiểm tra trên Firebase Emulator.

`product-store-runtime.test.js` chạy mã nguồn catalog thật trong browser context giả lập để kiểm tra cache/fallback/offline, không sửa chuỗi nguồn để bỏ qua hàm cần đo. `review-image-processing.test.js` kiểm tra vòng nén ảnh và thu hồi blob URL. `order-promotion-boundaries.test.js` kiểm tra lịch ưu đãi theo giờ Việt Nam và làm tròn tiền. Luồng offline còn có E2E `product-store-offline.spec.js` trên desktop/mobile.

### Danh sách bộ kiểm thử

| File | Phạm vi |
| --- | --- |
| `product-page.test.js` | Hiển thị và tương tác trang sản phẩm |
| `product-related.test.js` | Gợi ý sản phẩm liên quan, loại bỏ trùng lặp |
| `product-categories.test.js` | Phân loại sản phẩm theo danh mục |
| `product-store-sync.test.js` | Gộp catalog từ Firestore với dữ liệu mặc định |
| `shopping-store.test.js` | Giỏ hàng, yêu thích, giới hạn tồn kho |
| `shopping-sync.test.js` | Chuẩn hóa dữ liệu, gộp lần đầu, đồng bộ giữa thiết bị và giữ bản cục bộ khi lỗi mạng |
| `cart-per-account.test.js` | Cách ly giỏ hàng theo tài khoản và đếm tổng số sản phẩm |
| `store-footer.test.js` | Footer dùng chung |
| `order-pricing.test.js` | Tính giá, ưu đãi, làm tròn VND, giá trình duyệt khớp giá máy chủ |
| `order-validation.test.js` | Dữ liệu đơn hàng hợp lệ/không hợp lệ, tra cứu công khai không lộ thông tin |
| `privacy-policy.test.js` | Nội dung chính sách quyền riêng tư bao quát dữ liệu, mục đích, lưu trữ và yêu cầu xóa |
| `safe-storage.test.js` | Dữ liệu checkout nhạy cảm chỉ tồn tại trong session storage |
| `security-config.test.js` | File môi trường cục bộ được bỏ qua; template không chứa thông tin xác thực |
| `transport-security.test.js` | Yêu cầu HTTPS cho smoke test; xác nhận cấu hình HSTS và CSP |
| `order-status.test.js` | Trạng thái đơn và trạng thái cũ |
| `api-handlers.test.js` | Thân các API khu vực giao hàng, phí gói bó, giá hoa, sản phẩm, tài khoản/nhật ký quản trị và yêu cầu thiết kế với Firestore giả (`helpers/fake-firestore.js`): quyền, nhánh lỗi, dữ liệu ghi xuống và audit |
| `api-orders.test.js` | Luồng đơn hàng với Firestore giả: báo giá, khuyến mãi, thiếu hàng, tạo đơn trừ kho, chống đặt trùng, giá thay đổi, tra cứu công khai/theo tài khoản, giới hạn tra cứu, dọn đơn hết hạn |
| `helper-modules.test.js` | Kiểm tra/nén ảnh đánh giá, lỗi cấu hình Firebase Admin, kiểm tra quyền admin/owner, gợi ý chính sách mật khẩu |
| `integration/feature-orders.test.js` | Báo giá, tạo đơn, trừ kho, chống đặt trùng, ưu đãi, đơn hết hạn, tra cứu |
| `integration/feature-accounts.test.js` | Đơn gắn tài khoản, token giả/thu hồi, đánh giá của chủ đơn |
| `login-protection.test.js`, `password-auth.test.js` | Giới hạn theo tài khoản, chu kỳ khóa, đồng thời, lỗi dịch vụ và chặn đường gọi Firebase trực tiếp |
| `local-server.test.js` | Frontend/API cùng origin, JSON và giới hạn dữ liệu, chặn đọc bí mật/mã nội bộ, kiểm tra Host/Origin, API đăng nhập thật trả lỗi cấu hình có cấu trúc |
| `local-accounts.test.js`, `local-auth-http.test.js` | Tài khoản tự tạo không cần email thật, scrypt, SQLite, phiên HttpOnly, giới hạn theo tài khoản, PIN, 3 câu hỏi và chuyển dữ liệu cũ |
| `flower.com/e2e/local-accounts.spec.js` | Đăng ký/đăng nhập/đăng xuất, hồ sơ, đổi PIN, quên PIN bằng 3 câu hỏi, khóa và khôi phục mật khẩu trên desktop/mobile; chạy bằng `npm run test:e2e:local`, không cần emulator |
| `integration/login-protection.test.js` | Đăng nhập và phiên custom token thật, khóa tài khoản, hoàn tất đặt lại mật khẩu trên emulator |
| `flower.com/e2e/forgot-password.spec.js` | Trang khôi phục trên desktop/mobile: email không hợp lệ, thông báo không tiết lộ tài khoản, lỗi mạng/giới hạn gửi, đặt lại mật khẩu và mở khóa trên emulator |
| `integration/feature-admin.test.js` | API quản trị: danh sách tài khoản, cấp/thu quyền, khôi phục sản phẩm |
| `integration/system.test.js` | Đặt hàng → admin giao → khách theo dõi, đánh giá → trang sản phẩm |
| `integration/security-rules.test.js` | Firestore Security Rules cho từng loại dữ liệu |
| `integration/security-api.test.js` | API khi thiếu/sai xác thực hoặc không đủ quyền |

Mỗi tính năng mới viết test trước (xem `CONTRIBUTING.md`).

## Báo cáo kết quả

Sau mỗi đợt chạy test, sao chép `docs/test-reports/TEMPLATE.md` thành `docs/test-reports/YYYY-MM-DD.md` (nếu cùng ngày đã có báo cáo, thêm hậu tố như `-ci` hoặc `-2`). Ghi lại commit/nhánh nếu biết, môi trường, từng lệnh đã chạy, kết quả đạt/trượt, thông báo lỗi và các bước tái hiện tối thiểu. Nếu không có test nào trượt, ghi rõ `Không có` ở mục lỗi và tái hiện. Không đưa token, mật khẩu, thông tin khách hàng hoặc bí mật môi trường vào báo cáo.

Khi một test thất bại, giữ nguyên đầu ra lỗi liên quan, xác định test/file bị ảnh hưởng và mô tả các bước cần thiết để chạy lại. Không đánh dấu đợt kiểm thử là đạt nếu có test bị bỏ qua hoặc không chạy; hãy nêu rõ trạng thái thực tế.

## Kiểm thử giao diện trên trình duyệt

### Nút ẩn/hiện mật khẩu — không cần Firebase Emulator

```sh
cd flower.com
npm run test:auth-visibility
```

Trên PowerShell có execution policy chặn script, dùng `npm.cmd run test:auth-visibility`. Cài Chromium bằng `npx playwright install chromium` nếu chưa có; hoặc đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` tới trình duyệt Chromium đã cài. Bộ test dùng lại Playwright và hai cấu hình desktop/mobile của dự án, mở máy chủ static trên loopback cổng 4175.

`e2e/helpers/password-visibility-fixture.js` mock module Firebase App/Auth ngay trong trình duyệt, chặn tất cả kết nối ra ngoài và mọi yêu cầu API/ghi dữ liệu. Service worker bị chặn trong cấu hình riêng. Listener ở capture phase chặn submit trước handler thật và đếm riêng từng form; mỗi test phải kết thúc với 0 submit, 0 lời gọi xác thực và 0 yêu cầu backend. Không tạo tài khoản, không tải SDK Firebase thật và không cần `.env` hay thông tin xác thực.

| File trong `flower.com/e2e/` | Phạm vi |
| --- | --- |
| `login-password-visibility.spec.js`, `signup-password-visibility.spec.js` | Bật/tắt từng ô, trạng thái độc lập, giá trị và validation không đổi, form hợp lệ nhưng nút không submit |
| `password-selection.spec.js` | Vùng chọn xuôi/ngược và con trỏ đầu/giữa/cuối, chuột/chạm, Tab/Enter/Space, API vùng chọn không hỗ trợ |
| `password-inactivity.spec.js` | Biên 2999/3000ms, đặt lại bộ đếm khi chỉnh sửa, bộ đếm riêng từng ô, hủy khi chủ động ẩn, không chạy bộ đếm cho ô đang che |
| `password-concealment.spec.js` | Che ngay khi `document.hidden=true` hoặc chuyển form, hủy timer, đồng bộ icon/nhãn, không tự hiện lại khi quay về |

Thời gian được điều khiển bằng Playwright Clock thay vì chờ 3 giây thật. Sự kiện dán/cắt/undo/redo được mô phỏng bằng `InputEvent`; chuyển tab được mô phỏng bằng `document.hidden` và `visibilitychange`, không thao tác clipboard hoặc tab thật của người dùng. Các thao tác gõ/xóa/thay vùng chọn, chuột/chạm và bàn phím dùng API trình duyệt của Playwright. Ảnh/trace khi thất bại nằm trong `test-results/auth-visibility/`.

### Luồng mua hàng trên Firebase Emulator

Các kịch bản Playwright nằm trong `flower.com/e2e/`. Chúng chạy trên Firebase Auth và Firestore Emulator, đồng thời mock API tạo đơn để kiểm thử không ghi dữ liệu lên cửa hàng thật. Cài Java 21 và Chromium cho Playwright, sau đó chạy:

```sh
cd flower.com
npm ci
npx playwright install chromium
npm run test:e2e:emulator
```

Kịch bản mua hàng chạy ở 1280×800 và 390×844, chụp ảnh tại từng bước và đánh trượt nếu có lỗi console hoặc request bị lỗi. Ảnh, trace khi thất bại và báo cáo HTML được lưu trong `test-results/` và `flower.com/playwright-report/`. CI chạy các kịch bản này cùng Firebase Emulator và lưu artifact của lần chạy.
