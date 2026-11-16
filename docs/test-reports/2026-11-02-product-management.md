# Kiểm tra và hoàn thiện quản lý sản phẩm – FlowerFlow

Ngày: 02/11/2026. Phạm vi: Nhiệm vụ 2, trên workspace hiện tại.

Không sửa dữ liệu production, không commit, không push, không merge. Workspace ban đầu đã có thay đổi ở `admin.js`, `admin.css`, `admin.html`, `e2e/admin-products.spec.js`; các thay đổi đó được giữ lại, kiểm tra và hoàn thiện cùng đợt này. Không cài thêm dependency: Node 24, Playwright, Firebase SDK/CLI và JDK 21 cục bộ đã có sẵn.

## A. Phân tích và chức năng đã kiểm tra

Kiến trúc giữ nguyên: trang Admin gọi `FlowerInventory` trong `product-store.js`; Firestore là dữ liệu chính, localStorage là cache, `flower.json` là catalog khởi tạo/khôi phục. API `products.js` phục vụ đọc catalog và khôi phục; trang khách lọc sản phẩm ẩn. Đơn hàng giữ bản sao thông tin sản phẩm, không phụ thuộc việc sản phẩm còn trong catalog. Đã đọc README/kiến trúc, store, validation, API sản phẩm, Rules, các luồng hiển thị, CSS và test liên quan.

| Chức năng | Kết quả | Bằng chứng/phạm vi |
| --- | --- | --- |
| Thêm sản phẩm, tên/giá/tồn kho/danh mục/mô tả/ảnh | PASS | Validation hiện có; E2E nhập sai/đúng, Rules kiểm tra ghi trực tiếp và store thật ghi Emulator |
| Chống nhấn lưu liên tục | PASS | Hai submit liên tiếp chỉ tạo một lần lưu thành công; khóa trong lúc lưu |
| Thông báo lỗi/thành công tiếng Việt | PASS | E2E lỗi lưu, sửa/thêm thành công; integration lỗi quyền/mạng |
| Sửa giá, ảnh và dữ liệu bền sau tải lại | PASS | Browser reload fixture; riêng store thật đọc lại Firestore và API khách thấy giá/ảnh mới |
| Xóa có xác nhận, hủy xác nhận giữ sản phẩm | PASS | Bấm nút thật trên desktop/mobile; CRUD Emulator |
| Ẩn/hiện sản phẩm | PASS | E2E, API công khai loại sản phẩm ẩn; integration đặt hàng hiện có từ chối hàng ẩn |
| Xóa sản phẩm không mất lịch sử đơn | PASS | Store thật xóa sản phẩm test, snapshot thông tin sản phẩm trong đơn vẫn nguyên |
| Tồn kho không âm, còn/sắp hết/hết hàng | PASS | Validation, Rules và E2E; sửa giá không ghi đè số lượng đã thay đổi trên server |
| Chặn mua vượt tồn kho/hàng ẩn | PASS | Kiểm thử luồng đặt hàng hiện có trên Emulator; không sửa mã giỏ/checkout/orders |
| Tìm tên, danh mục, trạng thái, khoảng giá, sắp giá | PASS | E2E có kết hợp bộ lọc, tăng/giảm, khoảng giá đảo và kết quả rỗng |
| Admin/Owner CRUD, Customer/Guest bị chặn | PASS | Rules Emulator và SDK thật; thu hồi `adminRoles` làm lưu thất bại |
| Mất mạng không cập nhật cache như đã lưu | PASS | Cờ offline được kiểm tra; lỗi transport `unavailable` được giả lập tại SDK và lỗi UI qua fixture |
| Preview và ảnh hỏng/URL nguy hiểm | PASS | Browser xử lý 404, nhiều ảnh, `javascript:` bị từ chối; ảnh lỗi không đổi sang ảnh hoa ngẫu nhiên |
| F27 có ảnh gốc riêng đúng sản phẩm | FAIL | Catalog nguồn dùng chung ảnh; không có bằng chứng/ảnh gốc để thay chính xác |
| Responsive và lỗi JavaScript | PASS | E2E desktop/Pixel 7, 320/390/768px và ảnh chụp; không có `pageerror` trong bài Admin |
| CRUD và tài khoản trên Firebase production | NOT TESTED | Không thực hiện thao tác ghi/xóa production; chưa xác minh Rules triển khai thực tế |
| Thiết bị điện thoại vật lý | NOT TESTED | Chỉ Chromium desktop và giả lập Pixel 7 |

## B. Lỗi và nguyên nhân

| Mức độ | File/vị trí | Nguyên nhân và tác động |
| --- | --- | --- |
| Cao | `firestore.rules:12`, khối products | Trước đây chỉ kiểm tra quantity/status. Admin ghi trực tiếp bằng SDK có thể lưu tên trắng/giá âm hoặc phân số, bỏ qua form |
| Cao | `product-store.js:323`, writeRemoteProducts | Batch ghi có thể nằm trong hàng đợi offline; chưa kiểm tra xung đột cùng trường hoặc trùng mã. Cache sau lưu có thể giữ tồn kho cũ dù server đã đổi |
| Trung bình | `admin.js:1427`, addNewProduct | Cần khóa submit và mã ngẫu nhiên; Date.now có thể va chạm khi nhiều phiên cùng tạo. Form sửa sản phẩm đã bị xóa cần thông báo thay vì thành công giả |
| Trung bình | `admin.css:103`, panel-wrap/panel | Grid mặc định giữ kích thước tối thiểu của bảng, làm tràn trang 558px khi viewport 320px; thao tác nút trên mobile không ổn định |
| Trung bình | `flower.json:186`, sản phẩm 27 và các nhóm ảnh bên dưới | 50 bản ghi chỉ tham chiếu 6 ảnh. Đây là gán trùng trong dữ liệu nguồn, không phải fallback tự thay tất cả bằng ảnh F27 |
| Thấp | `admin.js:502`, báo cáo ảnh; `admin.css:636` | Thiếu báo cáo nhóm dùng chung ảnh; thông báo ảnh dài bị cắt trong khung cao cố định |
| Thấp | `admin.js:2350`, refreshProductTabKeepingEdits | Khôi phục giá trị URL đang nhập sau render nhưng preview chưa được vẽ lại theo URL đã khôi phục |
| Thiếu chức năng | `admin.js:300`, renderProductTab | Bộ lọc Admin cần khoảng giá, sắp giá và kiểm tra khoảng giá đảo; thay đổi đã có trong workspace được giữ và kiểm chứng |

## C. Sửa trực tiếp trong mã nguồn

- Firestore Rules kiểm tra dữ liệu sản phẩm khi tạo; khi sửa kiểm tra các trường thay đổi để vẫn cho sửa tồn kho/trạng thái của bản ghi legacy. Chặn tên trắng, giá không phải số nguyên VND từ 1.000, thiếu ảnh/mô tả, tồn kho âm/phân số; giữ nguyên cơ chế claim Admin cộng `adminRoles`, Owner dùng quyền Admin hiện có.
- Store lưu bằng transaction, đọc tất cả sản phẩm chịu tác động trước khi ghi. Chỉ cập nhật trường Admin sửa; giữ tồn kho mới từ server trong cache. Nếu cùng trường đã đổi, sản phẩm đã bị xóa hoặc mã mới đã tồn tại: báo xung đột, không ghi đè. Kiểm tra offline trước khi gửi; chỉ cập nhật cache sau xác nhận ghi thành công.
- Form khóa lưu trong khi chờ, dùng UUID cho sản phẩm mới, giữ bản nháp khi lưu thất bại và báo sản phẩm sửa đã bị xóa. Không đổi đăng nhập hay luồng đặt hàng.
- Giữ/bổ sung bộ lọc giá, sắp xếp và báo khoảng giá sai. Thêm danh sách nhóm ảnh dùng chung; ảnh thiếu/hỏng ghi rõ tên/mã/đường dẫn, không lấy logo làm ảnh đại diện thay thế trong bảng Admin. Vẽ lại preview sau khi khôi phục draft từ subscription.
- Grid dùng `minmax(0, 1fr)` và panel có `min-width: 0`; bảng cuộn bên trong thay vì đẩy tràn trang. Khung báo lỗi ảnh tự tăng chiều cao, URL dài ngắt dòng.

### Điều tra F27 và ảnh cần xác nhận

Sản phẩm `27 – Bó hoa xuân tỏa sáng` tham chiếu `./images/flower-03.webp`; file tồn tại và cũng được dùng bởi 7 sản phẩm khác. Cả 6 file đều tồn tại và có SHA-256 khác nhau. Không thấy bộ ảnh riêng cho 50 sản phẩm trong thư mục images. Không sửa `flower.json` hoặc Firestore bằng ảnh suy đoán.

Các mã dưới đây cần người phụ trách nội dung xác nhận ảnh dùng chung có chủ ý hay cung cấp ảnh riêng:

| Ảnh hiện tại | Mã sản phẩm |
| --- | --- |
| flower-01.webp | 1, 7, 13, 19, 25, 31, 37, 43, 57 |
| flower-02.webp | 2, 8, 14, 20, 26, 32, 38, 44, 58 |
| flower-03.webp | 3, 9, 15, 21, **27**, 33, 39, 45 |
| flower-04.webp | 4, 10, 16, 22, 28, 34, 40, 46 |
| flower-05.webp | 5, 11, 17, 23, 29, 35, 41, 47 |
| flower-06.webp | 6, 12, 18, 24, 30, 36, 42, 48 |

Admin có thể thay ảnh từng sản phẩm bằng URL đúng và xem trước. Ảnh không tải được vẫn được báo để người quản trị sửa; không chặn lưu chỉ dựa vào việc tải preview thất bại vì URL ngoài có thể bị chặn hoặc lỗi tạm thời.

## D. Kiểm thử đã chạy

1. Tại `flower.com`: `npm.cmd test` → **77 đạt, 0 thất bại** sau thay đổi store/Rules.
2. `npm.cmd run test:e2e -- admin-products.spec.js catalog-search.spec.js bouquet-options.spec.js mobile-layout.spec.js` → **14 đạt, 0 thất bại** sau sửa bố cục. Hai lượt Admin bấm nút thật, có kiểm tra reload, hủy xóa, chống double submit, URL hỏng và lỗi lưu. Các browser test dùng fixture SDK/store/API; không coi đây là bằng chứng ghi production.
3. `firebase emulators:exec ... "node --test --test-concurrency=1 tests/integration/*.test.js"` → **54 đạt, 0 thất bại, 0 bỏ qua** trong 26,5 giây. Suite chạy project `demo-flowerflow`, Auth/Firestore cục bộ. Bài mới thực thi mã `product-store.js` thật với Firebase SDK thật và Security Rules thật; chỉ thay phần nạp dependency và localStorage. Nhánh lỗi transport được giả lập rõ ràng, không phải mất mạng vật lý. Log cục bộ: `.tools/product-integration.log` (Git bỏ qua).
4. `node --check flower.com/admin.js`, `node --check flower.com/product-store.js`, `git diff --check` → đạt, không lỗi cú pháp/whitespace. Có cảnh báo Node phân loại module và Playwright NO_COLOR/FORCE_COLOR, không làm test thất bại.
5. Đã xem ảnh chụp Admin mobile 320px sau sửa; báo ảnh thiếu đọc được, form vừa chiều ngang, bảng cuộn trong khung. Ảnh browser nằm trong `test-results/` (Git bỏ qua).

Lần test mở rộng đầu tiên có **2 E2E thất bại** do tràn trang/nút mobile; đã sửa nguyên nhân và chạy lại 14/14 đạt. Bài thử `disableNetwork` của SDK không chặn transaction RPC trong môi trường này, làm một kỳ vọng test thất bại; test lỗi transport được đổi sang injection có chủ đích, không tuyên bố đã mô phỏng đứt mạng vật lý.

Lệnh integration từ thư mục gốc (PowerShell, Java đã có trong `.tools/`):

```powershell
$env:JAVA_HOME = (Resolve-Path '.tools/java21/jdk-21.0.13.0.2+1').Path
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-flowerflow --config flower.com/firebase.json --only auth,firestore "node --test --test-concurrency=1 tests/integration/*.test.js"
```

## E. File thay đổi

| File | Mục đích |
| --- | --- |
| flower.com/admin.js | Khóa lưu, UUID, báo xóa/xung đột, bộ lọc giá, kiểm tra ảnh dùng chung/lỗi, refresh preview |
| flower.com/admin.css | Bộ lọc, báo ảnh, sửa grid mobile và khung lỗi ảnh |
| flower.com/admin.html | Phiên bản cache Admin và product-store |
| flower.com/product-store.js | Transaction, chống ghi đè/xung đột, offline guard, cache dữ liệu xác nhận |
| flower.com/firestore.rules | Validation sản phẩm khi tạo/sửa, giữ nguyên quyền hiện có |
| flower.com/product.html | Dùng product-store v23 |
| flower.com/wish.html | Đồng bộ product-store v23 |
| flower.com/e2e/admin-products.spec.js | Form/lọc/ảnh/mạng/double submit, reload/xóa thực tế, ảnh 320px |
| tests/integration/product-management.test.js | CRUD bền, cache, API công khai, snapshot đơn, xung đột, Rules và lỗi lưu |
| docs/test-reports/2026-11-02-product-management.md | Báo cáo này |

## F. Vấn đề còn tồn tại và giới hạn

- Cần ảnh gốc hoặc xác nhận chủ ý dùng chung ảnh để xử lý dứt điểm F27; đã xác định nhóm sản phẩm cần bổ sung, không có cơ sở đổi ảnh tự động.
- Chưa triển khai Rules mới lên Firebase thật. Sau khi nhóm duyệt mã, người có quyền Firebase cần triển khai Rules và kiểm tra bằng tài khoản Admin/Owner/Customer trên môi trường staging; test hiện tại chỉ chứng minh bộ Rules trong repo.
- Website production chưa được kiểm thử CRUD. Công cụ đọc URL được cung cấp không truy cập được trang; không suy luận đó là website ngừng hoạt động. Không dùng tài khoản thật, không ghi/xóa sản phẩm thật.
- Firestore vẫn cho đọc sản phẩm ẩn trực tiếp theo thiết kế hiện tại; ẩn là ngừng bán, không phải bảo mật catalog. Trang khách/API công khai loại hàng ẩn và API đặt hàng từ chối bán. Luồng đặt hàng được kiểm thử, không sửa mã.
- Không bảo đảm mọi URL ảnh ngoài còn sống về sau. Preview giúp phát hiện tại thời điểm nhập; cần đơn vị quản lý ảnh cung cấp URL ổn định.

## G. Đề xuất tối đa 3 commit

Chưa tạo các commit này:

1. `fix(products): persist inventory safely and validate product writes` — product-store, Rules, integration test, phiên bản store trên các trang.
2. `fix(admin): complete product filters and image diagnostics on mobile` — Admin JS/CSS/HTML và E2E liên quan.
3. `docs: report product management audit and image gaps` — báo cáo này.

Nếu chia commit, stage từng phần `admin.html` cho phiên bản store/Admin tương ứng. Không tự push hoặc merge.
