# Rà soát issue đang mở — #123

Ngày rà soát: **11/11/2026**, múi giờ Việt Nam. Mốc mã nguồn: [`c28c073`](https://github.com/Longg5048/flower.com/commit/c28c073a1d5e8079fcff14282d3c639e32f38165) trên `main`.

Đã đọc toàn bộ **19 issue mở**, không tính pull request. Quyết định: đóng #42, #94, #120; giữ mở 15 issue còn thiếu; đóng #123 sau khi cập nhật xong các issue. Không đóng một issue chỉ vì có mã nguồn tương tự hoặc checklist cũ đã được tick.

Kiểm chứng mới trong phiên rà soát: **181/181 unit test đạt**, không bỏ qua ca nào, bằng `node --test "tests/*.test.js"`. Không sửa mã nghiệp vụ. Kết quả integration/E2E của #120 bên dưới là bằng chứng đã ghi ở [security-csp.md](security-csp.md), không tuyên bố chạy lại trong phiên rà soát này.

Các đường dẫn nguồn/test trong báo cáo là tương đối với gốc repository; khi cập nhật issue dùng liên kết tới đúng mốc mã nguồn nêu trên. Quyền GitHub hiện tại không có `admin`; API branch protection trả 404 nên **không đủ bằng chứng kết luận nhánh đã được bảo vệ hay chưa**.

## #39 — Giữ mở

Đã có VNPay và COD trong checkout, tạo URL từ tổng tiền máy chủ, xác thực IPN/chữ ký/số tiền, xử lý gửi trùng, kết quả/thanh toán lại và hoàn kho đơn hết hạn.

- [x] Đối chiếu `flower.com/api/payments.js`, `flower.com/api/vnpay-ipn.js`, `flower.com/lib/vnpay.js`, `flower.com/api/orders.js` và `flower.com/checkout.html`.
- [x] Có test `tests/vnpay.test.js` và `tests/integration/vnpay.test.js`; integration gồm thành công, sai số tiền, IPN trùng/thất bại và đơn hết hạn. [Commit triển khai VNPay](https://github.com/Longg5048/flower.com/commit/b0d193f664a08bb6f973babe63787629cbf83e36).
- [ ] Còn lại: xác nhận tài khoản merchant sandbox và biến bí mật trên hosting; lưu bằng chứng giao dịch qua VNPay sandbox thật, IPN tới URL triển khai và các kịch bản lỗi. Test emulator không thay thế sandbox. Phối hợp #119; không đưa khóa/log nhạy cảm lên issue.

## #42 — Đóng

- [x] Header dùng `flower.com/js/core/store-header.js`, icon nội bộ; không còn chuỗi `contentstack`, `akamaized` hay tham chiếu `product-names` trong HTML/JS/JSON ứng dụng (không tính lockfile/dependencies).
- [x] `flower.com/flower.json` có 30 sản phẩm với tên/mô tả tiếng Việt và ảnh WebP trong repo; tài liệu `docs/product-image-credits.md` ghi nguồn, tác giả và giấy phép của từng ảnh. Đây là đối chiếu bằng chứng ghi công đang có, không phải thẩm định pháp lý độc lập.
- [x] Test `tests/product-page.test.js` và `tests/seo-performance.test.js` đạt trong lượt unit mới, kiểm tra catalog, ảnh nội bộ và các tài nguyên trang. [Commit chứa bảng ghi công](https://github.com/Longg5048/flower.com/commit/89fc133).

Hoàn thành tiêu chí loại bỏ tài nguyên hotlink thương hiệu khác. Quyền sử dụng mã fork và LICENSE của repository là phạm vi riêng ở #130.

## #94 — Đóng

- [x] Firebase Authentication xử lý mật khẩu Firebase; `flower.com/api/login.js` không log body, mật khẩu, token hoặc response upstream.
- [x] Tài khoản local dùng `scryptSync` với salt ngẫu nhiên và so sánh hash trong `flower.com/lib/local-accounts.js`; không lưu mật khẩu gốc trong SQLite hoặc dữ liệu phiên trả về.
- [x] Test `tests/local-accounts.test.js` kiểm tra dữ liệu lưu không chứa secret gốc, đăng nhập, đặt lại mật khẩu và thu hồi phiên; `tests/password-auth.test.js` kiểm tra lỗi/password và không trả token upstream; `tests/login-security.test.js` kiểm tra thông báo lỗi không tiết lộ chi tiết lạ. Tất cả đạt trong lượt unit mới.
- [x] Chính sách mật khẩu mới và gợi ý đã có test riêng `tests/password-policy.test.js`. [Commit chính sách local](https://github.com/Longg5048/flower.com/commit/e62b98e).

Không tự triển khai băm mật khẩu Firebase. Bật chính sách mạnh trên Firebase production/MFA là phạm vi tiếp tục của #121, không phải bằng chứng mật khẩu đang lưu dạng thuần.

## #95 — Giữ mở

- [x] Phiên local có hạn tuyệt đối 12 giờ, cookie HttpOnly/SameSite/Path/Max-Age, Secure khi kết nối TLS thật; đăng xuất xóa bản ghi phía máy chủ, cookie cũ không dùng lại được. Test `tests/session-security.test.js` và `tests/local-accounts.test.js` đạt trong lượt unit mới. Xem `flower.com/lib/local-session.js`, `flower.com/js/account/session-lifecycle.js` và `docs/security/2026-11-09-session-security.md`.
- [x] Firebase phía trình duyệt gọi `signOut` trong `flower.com/js/account/account.js`; API dùng `verifyIdToken(token, true)` để kiểm tra token hết hạn/đã thu hồi (`flower.com/lib/request-identity.js`). [Commit phiên local](https://github.com/Longg5048/flower.com/commit/d70e24395383f8f74a742fc955a90f03ee66da2c).
- [ ] Còn lại: xác định rõ phạm vi đăng xuất Firebase theo thiết bị/toàn bộ tài khoản; triển khai hoặc chứng minh thu hồi phía máy chủ tương ứng. Chưa thấy thao tác logout khách hàng gọi `revokeRefreshTokens`; `signOut` trên trình duyệt không phải bằng chứng token sao chép đã mất hiệu lực tại API.
- [ ] Bổ sung test phát lại token Firebase sau logout/hết hạn và chứng minh bị từ chối. Không đồng nhất báo cáo phiên local với kiểm chứng Firebase thật.

## #107 — Giữ mở

**Trạng thái thiết kế: mới là yêu cầu, chưa có thiết kế chi tiết được chốt và chưa có triển khai giá héo tự động.** `docs/database/DATABASE-DESIGN.md` mục mở rộng chỉ đề cập khả năng thêm `PriceRule`/bảng riêng sau này.

- [x] Mã hiện tại có giá theo sản phẩm/cành, cập nhật giá trong ngày và ưu đãi; các cơ chế này không phải công thức giảm giá theo tuổi hoa.
- [ ] Chốt công thức được phép, mốc thời gian/tuổi lô hoa, múi giờ, giá sàn, quy tắc làm tròn và thứ tự ưu tiên khi áp dụng toàn bộ/nhóm/từng hoa.
- [ ] Thiết kế dữ liệu và giao diện owner cấu hình; xác định giá từng bó trong nhóm, không yêu cầu mua cả nhóm.
- [ ] Triển khai máy chủ báo giá và snapshot giá khi đặt hàng, xử lý kho/lô và kết hợp ưu đãi; test biên thời gian, giá sàn, xung đột quy tắc và quyền cấu hình.

Không tạo thiết kế giả hoặc đánh dấu chức năng hoàn thành chỉ từ ghi chú mở rộng schema.

## #118 — Giữ mở

- [x] Có workflow cleanup và backup; backup đã có restore preview không ghi dữ liệu. Bằng chứng mã và test giả lập: `docs/issue-118-operations.md`, `.github/workflows/backup.yml`, [commit `06184ab`](https://github.com/Longg5048/flower.com/commit/06184ab).
- [x] API Actions tại thời điểm rà soát có variable `FLOWER_APP_URL` và secret `CRON_SECRET` (chỉ kiểm tra tên, không đọc giá trị).
- [ ] Chưa có `FIREBASE_SERVICE_ACCOUNT_JSON` và `BACKUP_PASSPHRASE` trong repository Actions secrets. Run cleanup đã kiểm tra gần nhất được ghi trong báo cáo là [42940689437](https://github.com/Longg5048/flower.com/actions/runs/42940689437), thất bại HTTP 401; chưa chạy lại trong phiên rà soát này.
- [ ] Còn lại: cấu hình đúng secret, chạy xanh cả hai workflow, có artifact mã hóa/preview từ backup thật và đủ bằng chứng chạy theo lịch liên tục ít nhất 24 giờ.

## #119 — Giữ mở

- [x] Có mã VNPay, Firestore Rules và các test emulator; có báo cáo kiểm tra HTTPS trước đây trong repository.
- [ ] Metadata repository vẫn trỏ `https://genuine-malabi-a05086.netlify.app/`, trong khi tài liệu/mã có URL Vercel; cần chốt và đồng bộ URL chính thức.
- [ ] Còn thiếu bằng chứng deploy Rules đúng project, giao dịch VNPay sandbox thật và Lighthouse có ngày trên URL chính thức. `flower.com/checkout.html` hiện chỉ chọn COD/VNPay; phần mô tả QR cũ cần đồng bộ với #122.

## #120 — Đóng

- [x] Bốn script thực thi inline đã tách sang file riêng; không có style/handler inline trong 23 trang HTML. Bộ tạo CSP, cấu hình production, server local và server E2E đã được đồng bộ.
- [x] Không có `unsafe-inline` trong script/style; `img-src` giới hạn cùng origin, data/blob, Storage, Google avatar và VietQR.
- [x] `tests/security-config.test.js` đạt trong lượt unit mới. Báo cáo `docs/security-csp.md` ghi 181 unit, 91 integration, 142 E2E đạt; sau tích hợp main còn kiểm tra 60 E2E và 10 test liên quan đều đạt. [Commit cuối #120](https://github.com/Longg5048/flower.com/commit/c28c073a1d5e8079fcff14282d3c639e32f38165).

Đạt tiêu chí mã nguồn và kiểm thử của #120. Kiểm chứng deployment production vẫn thuộc #119, không được suy ra từ E2E local.

## #121 — Giữ mở

- [x] Đã cập nhật form đăng ký/đặt lại, API local, thông báo/gợi ý, test và đánh giá MFA trong `docs/wiki/Non-Functional-Requirements.md`. [Commit tài liệu kết thúc đợt #121](https://github.com/Longg5048/flower.com/commit/2f69b64).
- [ ] Chưa có bằng chứng Firebase Password Policy production được lưu ở chế độ Require với yêu cầu thống nhất. Cần kiểm tra tạo/đặt lại mật khẩu yếu bị dịch vụ từ chối khi bỏ qua frontend. MFA mới được đánh giá, chưa bật; issue chỉ yêu cầu đánh giá, không cần biến việc bật MFA thành tiêu chí bổ sung.

## #122 — Giữ mở

- [x] Đã đối chiếu API GitHub: release `v0.1.0` phát hành ngày 14/10/2026; `docs/RELEASE_NOTES_v0.1.0.md` vẫn ghi chưa phát hành. Checkout hiện có COD/VNPay.
- [ ] Còn lại: sửa trạng thái release dựa trên release có thật, mô tả tài khoản local/Firebase, mô tả thanh toán, URL thống nhất và số/cách chạy test. Lượt unit hiện tại là 181, không dùng số cũ 171 như mô tả ban đầu.

## #123 — Đóng

- [x] Đã đối chiếu toàn bộ 19 issue đang mở với main, bao gồm #39, #42, #94, #95, #107.
- [x] Có quyết định kèm đường dẫn mã/test cho từng issue; chỉ đóng issue hoàn thành và giữ mở các phần thiếu chứng cứ production.
- [x] #107 được ghi rõ mới là yêu cầu và ghi chú mở rộng dữ liệu, chưa có thiết kế chi tiết/triển khai.
Quy trình áp dụng: cập nhật phạm vi các issue trên GitHub, đóng #42/#94/#120 kèm bình luận bằng chứng, rồi đóng #123 sau cùng. Báo cáo commit không tự thay đổi trạng thái GitHub; kết quả thực thi được ghi riêng trong biên bản.

## #124 — Giữ mở

- [x] Có yêu cầu KH/QT/NF trong `docs/wiki/Functional-Requirements.md` và `Non-Functional-Requirements.md`.
- [ ] Chưa thấy `docs/wiki/Traceability-Matrix.md` hay ma trận thay thế. Còn lập đủ yêu cầu → story → issue/commit → test → link CI và đánh dấu phần chưa test, thêm liên kết từ hai trang yêu cầu.

## #125 — Giữ mở

- [x] Repository có unit/integration/E2E; lượt kiểm tra mới có 181 unit đạt.
- [ ] `.github/workflows/ci.yml` vẫn dùng `--min-lines=50`. Chưa có bảng coverage mới trong phiên này chứng minh mọi module được issue nêu đều đạt ít nhất 50%; không dùng việc test xanh để suy ra coverage. Còn bổ sung test rủi ro, đo lại coverage và nâng ngưỡng khi đủ cơ sở.

## #126 — Giữ mở

- [x] Có Firebase Emulator cho môi trường thử, wiki NF-01/NF-02 vẫn ghi chưa có bằng chứng uptime/load test.
- [ ] Chưa thấy kịch bản và báo cáo tải tăng 10–20 lần hoặc dữ liệu uptime ít nhất hai tuần. Còn đo p95/tỷ lệ lỗi/tranh chấp giữ kho trên môi trường thử, cấu hình monitor URL chính thức và thu đủ dữ liệu.

## #127 — Giữ mở

- [x] Có `CONTRIBUTING.md`, mẫu PR, `.github/main-branch-protection.json`, `docs/branch-protection.md` và `docs/TEAM.md`.
- [ ] `TEAM.md` còn nhiều danh tính/alias chờ xác nhận. Quyền API hiện tại không có admin; branch protection trả 404, không đủ để xác minh đã bật hay chưa.
- [ ] Còn xác minh cấu hình bắt buộc PR/approval/CI thực sự được áp dụng, review bởi thành viên khác trên PR mới và hoàn thành ánh xạ danh tính được phép công khai. File JSON chưa phải bằng chứng cấu hình đã có hiệu lực.

## #128 — Giữ mở

- [x] Có một số module phụ trợ trong `flower.com/js/admin/`.
- [ ] `admin.js` vẫn dài 3.176 dòng, chưa đạt mốc khoảng 800 dòng/file. Còn kế hoạch tách được nhóm chấp thuận, thực hiện từng nghiệp vụ không đổi hành vi và kiểm tra đầy đủ sau mỗi bước.

## #129 — Giữ mở

- [ ] Chưa thấy `docs/AI-USAGE-LOG.md` và mục AI tương ứng trong mẫu PR. Còn truy lại các PR được nêu, ghi công cụ/phần AI/phần người sửa/người chịu trách nhiệm/cách kiểm chứng; không tự gán người review hoặc bịa lịch sử sử dụng AI.

## #130 — Giữ mở

- [x] API GitHub xác nhận repository là fork của `Rajat24111994/flower.com`.
- [ ] Chưa thấy `docs/PROVENANCE.md` hoặc LICENSE cấp repository. Còn đối chiếu nguồn gốc/điều kiện sử dụng, phân biệt phần kế thừa và phần mới, ghi công và cập nhật README. Bảng ghi công ảnh của #42 không giải quyết quyền dùng mã fork; không tự cấp license khi chưa đủ căn cứ.

## #131 — Giữ mở

- [x] Wiki có yêu cầu và vai trò người dùng để làm đầu vào.
- [ ] Chưa thấy project charter, bộ persona, ghi chú nghiên cứu đã ẩn danh từ ít nhất 5 người hoặc biên bản usability có truy vết thay đổi backlog. Còn thực hiện nghiên cứu thật và liên kết từ Home; không thay bằng nội dung/phỏng vấn giả lập.
