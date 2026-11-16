# FlowerFlow – kiểm toán kỹ thuật production readiness

Ngày kiểm tra: 2026-11-09  
Phạm vi: mã nguồn hiện có tại `main`; không triển khai production, không gọi API Firebase thật và không tạo giao dịch thật.

## 1. Repository được kiểm tra

- Branch: `main`
- HEAD: `3ce88ca066eaf607b14b5326ad4a2a156c67a967` (`Fix unit CI SEO structured data`)
- HEAD trùng `origin/main` lúc bắt đầu kiểm tra.
- Workspace ban đầu sạch; không có thay đổi local chưa commit. Các thay đổi hiện tại đều do cuộc kiểm toán tạo ra.
- Đã đọc README gốc và README ứng dụng, `package.json`, Vercel config, Firestore Rules/indexes, release checklist, backup/restore procedure, GitHub Actions và mã API/backend/frontend liên quan.

## 2. Lỗi xác minh và cách xử lý

### P1 — Một số endpoint quản trị không kiểm tra quyền còn hiệu lực — đã sửa

`api/admin/audit.js`, `api/bouquet-wrapping.js` và `api/design-requests.js` chỉ xác minh Firebase ID token và claim `admin: true`. Chúng không kiểm tra bản ghi `adminRoles/{uid}`. Các API quản trị còn lại và Firestore Rules dùng bản ghi này để thu hồi quyền tức thì. Vì vậy, token cũ có thể tiếp tục gọi các endpoint này khi claim còn hạn nhưng mirror quyền đã bị xóa (ví dụ thao tác thu hồi claim lỗi sau khi xóa mirror).

Đã chuyển các nhánh quản trị của ba endpoint sang `verifyAdminRequest(req, res, auth, db)` trong `lib/firebase-admin.js`. Helper kiểm tra token còn hiệu lực, claim admin và role mirror. Đã thêm test xác nhận admin đang hoạt động được phép, còn token admin đã thu hồi bị từ chối ở GET/POST liên quan.

### P2 — Dependency phát triển còn cảnh báo moderate

`npm audit --omit=dev` ban đầu tìm thấy 8 moderate trong dependency production qua Firebase Admin 13. Đã nâng `firebase-admin` lên `^14.5.0` và cập nhật lockfile; audit production sau sửa là **0 vulnerability**.

`npm audit` đầy đủ vẫn báo **13 moderate**, đều nằm trong cây công cụ phát triển `firebase-tools` và dependency con, gồm advisory về OpenTelemetry baggage, `glob`/`minimatch`, `uuid` và gói nén. Không có high/critical. Chưa hạ cấp CLI hoặc áp dụng override cưỡng bức vì audit đề xuất một bản CLI cũ hơn; cần cập nhật toolchain có chủ đích rồi chạy lại emulator/CI.

## 3. Kết quả rà soát theo nghiệp vụ

### Xác thực, phân quyền và API

- API dùng Firebase Admin `verifyIdToken(token, true)`; guard quản trị kiểm tra claim và `adminRoles`. Các API Owner yêu cầu role Owner riêng.
- `firestore.rules` mặc định deny; đơn hàng không cho client tạo, trường thanh toán nhạy cảm chỉ cập nhật qua backend, giỏ hàng giới hạn theo UID, audit bị chặn ở client.
- Các API có kiểm tra quyền, schema/kiểu/giới hạn dữ liệu; API tra cứu đơn giới hạn thử và trả dữ liệu công khai đã rút gọn. Test IDOR xác nhận tài khoản khác không xem được đơn riêng.
- API ảnh sản phẩm yêu cầu admin và kiểm tra định dạng/nội dung ảnh, kích cỡ. Tải ảnh được kiểm qua API; không tìm thấy quyền ghi trực tiếp từ client trong rules.
- Các render nội dung đánh giá/phản hồi được kiểm thử escape; CSP chặn script inline tùy ý và script attributes. Rà soát này không phải chứng minh hình thức rằng mọi template `innerHTML` trong toàn bộ giao diện đều an toàn với mọi nguồn dữ liệu.
- Rate limit đăng nhập, đặt đơn, tra cứu đơn và giới hạn theo thời gian có test; index có TTL cho bộ đếm hết hạn.
- Không thấy token, mật khẩu hay service-account private key bị ghi log trong các luồng đã rà. Cấu hình bí mật lấy từ environment, không được trả về client.

### Thanh toán

- VNPay IPN kiểm tra chữ ký HMAC, merchant, số tiền VND đối chiếu với attempt và đơn; cập nhật trong transaction; callback trùng xử lý idempotent; test sai số tiền, callback thất bại/đến muộn, retry và đơn hết hạn.
- Trạng thái trả về trình duyệt không tự xác nhận giao dịch. E2E xác nhận redirect thành công/huỷ không thay đổi trạng thái server nếu IPN chưa xác minh.
- QR chuyển khoản VietQR không cung cấp xác minh ngân hàng tự động trong mã hiện tại; chỉ nên đánh dấu thanh toán khi admin đối soát bằng chứng giao dịch. Đây là công việc thủ công và phải được vận hành rõ ràng trước khi nhận thanh toán thật.
- Không kiểm thử giao dịch VNPay thật; cần thông tin sandbox/provider và cấu hình webhook/IPN để xác nhận tích hợp ngoài emulator.

### Đơn hàng và tồn kho

- Giá, ưu đãi, tổng tiền và tồn kho được xác định phía server; tạo đơn/idempotency/reservation dùng Firestore transaction.
- Integration test bao gồm hai khách tranh mặt hàng cuối, gửi lại cùng yêu cầu, hết hàng, cleanup, giữ hàng hết hạn, hủy/hoàn kho lặp và khôi phục sau lỗi.
- Cleanup chạy khi có request đặt/báo giá và có workflow GitHub mỗi 15 phút; Vercel cron hằng ngày làm dự phòng. Workflow GitHub cần `FLOWER_APP_URL` và `CRON_SECRET`; chưa kiểm tra được chúng đã được cấu hình trong repository settings hay chưa.
- Vercel cron cấu hình mỗi ngày, không phải cơ chế duy nhất. Chưa xác nhận lịch và lần chạy thành công trên hạ tầng GitHub/Vercel thật.

### Dữ liệu, giá và backup

- Đơn lưu snapshot giá/đơn vị; giá sản phẩm authoritative ở Firestore; có tương thích dữ liệu giá USD cũ và test quy đổi sang VND.
- Báo cáo doanh thu phân biệt thanh toán đã xác minh, COD, đơn huỷ và hoàn tiền trong test unit.
- Backup mã hóa bằng passphrase; integration test diễn tập backup → xóa dữ liệu emulator → restore và xác nhận dữ liệu/kiểu timestamp.
- Không xác nhận được lần backup production gần nhất, thời hạn artifact đang hoạt động, tính đúng của secrets bên GitHub, hoặc một lần restore production có giám sát. Test emulator không thay thế diễn tập restore production.
- Không thấy migration runner tổng quát cho mọi schema cũ; các xử lý legacy hiện nằm trong từng luồng đọc/ghi. Thay đổi schema lớn cần kế hoạch migration riêng và backup trước đó.

## 4. Tệp đã sửa

- `flower.com/api/admin/audit.js` — bắt buộc role mirror còn hiệu lực.
- `flower.com/api/bouquet-wrapping.js` — cùng guard cho quản trị đọc/ghi.
- `flower.com/api/design-requests.js` — cùng guard cho quản trị đọc/cập nhật.
- `flower.com/package.json`, `flower.com/package-lock.json` — Firebase Admin `^14.5.0`.
- `tests/integration/helpers.js`, `tests/integration/security-api.test.js` — đăng ký handler và regression tests cho admin đang hoạt động/đã thu hồi.
- `docs/security/2026-11-09-deep-technical-audit.md` — báo cáo này.

## 5. Kiểm thử thật đã chạy

| Lệnh | Kết quả |
|---|---|
| `npm test` (sau nâng SDK) | 171 pass, 0 fail |
| `npm run test:coverage` | 171 pass; line coverage 59.04%, vượt ngưỡng CI 50% |
| `npm run integration` (Firebase Auth/Firestore Emulator) | 91 pass, 0 fail; line coverage tích hợp 72.29% |
| `npm run test:e2e:emulator` (Playwright, desktop + mobile) | 68 pass, 0 fail |
| `npm run build` | pass |
| Syntax check theo logic CI | 97 file JavaScript pass |
| `npm audit --omit=dev` sau nâng SDK | 0 vulnerability |
| `npm audit` đầy đủ | 13 moderate ở dependency phát triển; 0 high/critical |
| Smoke test GET-only trên `https://flower-com-six.vercel.app` | 21/21 pass: TLS/HTTPS, headers, trang, quote và API từ chối truy cập trái quyền |

`npm run test:e2e` chạy không kèm emulator ban đầu có 64 pass, 2 fail ở luồng đăng nhập/đặt hàng do test cần Firebase Emulator. Chạy lệnh CI đúng `npm run test:e2e:emulator` thì cả 68 test pass. Đây là yêu cầu môi trường của suite, không phải lỗi production đã xác minh.

Một lần gọi test trong sandbox bị `spawn EPERM`; chạy lại bằng quyền tạo tiến trình cục bộ thì hoàn tất. Firebase CLI báo chưa đăng nhập, nhưng emulator dùng project demo và toàn bộ integration/E2E vẫn chạy thành công, không kết nối production. GitHub CLI không có trên máy nên trạng thái lần chạy Actions gần nhất chưa đối chiếu được.

## 6. Cấu hình và thao tác cần xác minh trước phát hành

- Vercel: `FIREBASE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`; `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV`, `PUBLIC_APP_URL` nếu bật VNPay. Xác minh Firebase Web App config/Authorized Domains và Firestore Rules/indexes đúng project.
- GitHub Actions backup: secrets `FIREBASE_SERVICE_ACCOUNT_JSON`, `BACKUP_PASSPHRASE`.
- GitHub Actions cleanup: variable `FLOWER_APP_URL`, secret `CRON_SECRET` đồng nhất với Vercel.
- Kiểm tra Actions backup xanh gần nhất và tải artifact; diễn tập restore có giám sát theo `docs/BACKUP-RESTORE.md`.
- Thực hiện VNPay sandbox end-to-end, kiểm tra chữ ký IPN trên endpoint deploy và xác nhận quy trình đối soát QR thủ công trước khi mở thanh toán thật.
- Đối chiếu CI GitHub, TLS/domain, headers, logs và cron trên deployment thật. Cuộc kiểm toán này không deploy production.
- Smoke test chỉ xác nhận deployment hiện có trả lời đúng; do không triển khai mã local, chưa xác nhận deployment đó chứa HEAD `3ce88ca` hoặc các bản sửa trong báo cáo này.

## 7. Đánh giá production readiness

**Chưa đủ bằng chứng để tuyên bố sẵn sàng production.** Mã nguồn có nền bảo vệ tốt cho API, Firestore, đơn hàng và thanh toán; toàn bộ test local/emulator/E2E đạt sau các sửa đổi và dependency production đã sạch theo `npm audit`. Tuy nhiên, việc cấu hình secrets và workflows từ xa, backup/restore production, VNPay sandbox thực tế, môi trường Firebase/Firestore thật và vận hành đối soát QR chưa được xác minh. Hoàn tất các bước thủ công ở mục 6 rồi mới nên mở cho giao dịch thật.
