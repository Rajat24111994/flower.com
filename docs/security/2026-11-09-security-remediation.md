# Khắc phục sau rà soát bảo mật — 09/11/2026

Áp dụng cho [các phát hiện trong báo cáo ban đầu](2026-11-09-application-security-audit.md). Giữ PIN 4–6 chữ số ASCII, khóa đăng nhập theo tài khoản và quy tắc sai PIN 5 lần phải trả lời ba câu hỏi để đổi PIN.

## Thay đổi đã thực hiện

| Mục | Thay đổi |
| --- | --- |
| SEC-01 — Đơn giả giữ hàng | Trong mỗi cửa sổ 15 phút: tối đa 5 đơn theo nguồn truy cập, 3 đơn theo số điện thoại chuẩn hóa, 5 đơn theo tài khoản nếu đã đăng nhập. Các hạn mức được đọc/ghi trong cùng transaction tạo đơn và trừ kho, lưu trên Firestore để dùng chung giữa các tiến trình. Đổi IP không vượt hạn mức của số điện thoại/tài khoản; đổi idempotency key không xóa hạn mức. Gửi lại cùng yêu cầu thành công vẫn trả đơn cũ. Khách vãng lai tối đa 5 sản phẩm mỗi loại/đơn. COD chưa xác nhận chỉ giữ hàng 30 phút, thay cho 24 giờ; cập nhật thông báo và luồng admin phục hồi đơn tương ứng. |
| SEC-02 — Đáp án yếu | Khi đăng ký/thiết lập câu hỏi: đáp án 6–200 ký tự, không trùng nhau sau chuẩn hóa, không chỉ có số, không là thông tin tài khoản hoặc một số chuỗi phổ biến/lặp lại. Vẫn phải trả lời đúng cả ba câu và đổi PIN trước khi dùng PIN mới đổi mật khẩu. |
| SEC-03 — Làm hết lượt PIN của người khác | Đặt lại mật khẩu, lấy câu hỏi và khôi phục PIN phải đối chiếu thêm họ tên/số điện thoại đã đăng ký. Thiếu hoặc sai thông tin này không tiêu hao bộ đếm PIN. Bổ sung trường nhập trên giao diện; tự điền từ phiên máy chủ còn hợp lệ nếu đúng tài khoản. Sau khi đối chiếu đúng, sai PIN 5 lần vẫn bắt buộc đổi PIN như yêu cầu. |
| SEC-04 — Nghẽn máy chủ | `npm run dev` dùng worker riêng cho SQLite và băm scrypt; hàng đợi tối đa 16 tác vụ đang chờ/xử lý, vượt ngưỡng trả 429. Kiểm tra trùng tên trước khi băm câu trả lời. HTTP còn giới hạn đăng ký 5 yêu cầu/10 phút/nguồn; đăng nhập và khôi phục mỗi nhóm 60 yêu cầu/15 phút/nguồn. Không giảm độ mạnh băm. |
| SEC-05 — Dò tài khoản qua câu hỏi | Chỉ biết tên đăng nhập không lấy được câu hỏi; tài khoản có/không tồn tại đều trả lỗi khôi phục giống nhau khi thiếu/sai thông tin đối chiếu. Bước này chịu hạn mức khôi phục. |
| SEC-06 — Quyền admin cũ | API dọn đơn thủ công dùng chung helper xác thực token và kiểm tra `adminRoles` hiện hành. Token chưa hết hạn nhưng đã xóa role bị từ chối 403; cron secret hợp lệ vẫn hoạt động. |
| SEC-07 — CSP | Bỏ `unsafe-inline` khỏi `script-src`, dùng hash cho script inline tĩnh được phép. Server local cũng có CSP; chỉ bổ sung kết nối emulator localhost trong chính sách local. Có lệnh `npm run update:csp` và `npm run build` để cập nhật hash sau khi sửa script inline. `style-src` vẫn cho inline CSS. |
| INT-01 — Danh tính local của đơn | Server xác thực cookie local rồi truyền danh tính nội bộ cho API, không lấy UID từ body/localStorage. Tạo và tra cứu đơn dùng cùng lớp xác thực. Cookie đã gửi nhưng giả/hết hạn trả 401. Thêm API liệt kê đơn của chính tài khoản và polling cho giao diện local, chặn xem đơn của tài khoản khác. Client kiểm tra phiên local trước khi tạo đơn nếu đang hiển thị tài khoản. |

Ngoài ra, nút gửi ở đăng nhập và khôi phục bị vô hiệu cho đến khi module JavaScript gắn xong sự kiện, tránh gửi biểu mẫu HTML gốc khi module chưa tải xong. Cập nhật phiên bản URL các script liên quan để trình duyệt tải mã mới.

## Bằng chứng kiểm tra

- Unit/HTTP/local: **160/160 đạt**, không bỏ qua ca nào.
- Tài khoản trên Chrome desktop/mobile: **14/14 đạt**, gồm đăng ký, đăng nhập, khóa mật khẩu, đổi PIN, khôi phục bằng câu hỏi, lỗi lần thứ năm, tải lại trang và chống giả dữ liệu localStorage. Mỗi ca dùng database/worker/hạn mức riêng, không nới hạn mức trong mã ứng dụng.
- XSS: **42/42 đạt**, không thực thi payload và không tạo phần tử HTML từ payload; fixture áp dụng CSP thật đã xác nhận script inline không có hash bị chặn (`cspInlineAllowed: false`).
- Tích hợp API/Firestore/thanh toán: **63 kịch bản đều đã đạt qua các lượt kiểm tra**. Lượt tổng đầu đạt 62/63; ca còn lại đòi mã cũ 401 trong khi helper mới trả đúng 403 cho khách đã xác thực nhưng thiếu quyền. Sau khi cập nhật kỳ vọng, nhóm phân quyền chạy lại **11/11 đạt**. Một lượt lặp tổng khác có 61 đạt và 2 ca hết thời gian/bị hủy; chạy riêng hai ca đó đạt **2/2**, nên không coi lượt bị timeout là một lượt tổng 63/63 thành công. Các ca bổ sung đã tái hiện việc chặn tạo đơn đồng thời vượt quota, đổi IP, gửi lại idempotency key, đặt hàng quá hạn mức khách, token admin cũ và phân quyền đơn bằng cookie local.

Môi trường: project **`demo-security-fixes`** trên Auth/Firestore emulator; SQLite thử trong bộ nhớ; Chrome headless. Không thử tấn công dịch vụ thật hoặc tạo thanh toán ngân hàng thật. Kết quả XSS dùng dữ liệu/SDK giả lập để kiểm tra DOM, không chứng minh an toàn ở mọi đường đi trên production.

Các kiểm thử mới: [unit/HTTP](../../tests/security-remediation.test.js), [API tích hợp](../../tests/integration/security-remediation.test.js). Các kiểm thử tài khoản cũ được bổ sung thông tin đối chiếu theo hợp đồng API mới; kiểm thử quyền dọn đơn dùng 403 cho người đã đăng nhập nhưng không có quyền, thay cho 401 trước đây.

Log lưu trong `flower.com/.tools/`: `security-fixes-unit-final.log`, `security-fixes-e2e-final.log`, `security-fixes-xss.log`, `security-fixes-integration-final.log`, `security-fixes-access-retest.log`, `security-fixes-integration-passed.log` (lượt tổng có timeout, tên tệp không phản ánh kết quả), `security-fixes-timeout-retest.log`. [Bằng chứng JSON sau sửa](2026-11-09-remediation-results.json) lưu các trạng thái này; không gộp số lần chạy lại thành số kịch bản mới.

## Chạy và triển khai

```powershell
Set-Location flower.com
npm.cmd test
npm.cmd run test:e2e:local
npm.cmd run update:csp
npm.cmd run dev
```

Chạy tích hợp từ thư mục gốc sau khi khởi động emulator ở terminal riêng, project `demo-security-fixes`:

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-security-fixes'
node --test --test-timeout=60000 --test-concurrency=1 tests/integration/security-api.test.js tests/integration/security-rules.test.js tests/integration/feature-accounts.test.js tests/integration/feature-orders.test.js tests/integration/vnpay.test.js tests/integration/login-protection.test.js tests/integration/security-remediation.test.js
```

Helper sẽ xóa dữ liệu project emulator thử trước các ca; không chạy đồng thời nhiều bộ tích hợp trên cùng project. Cần cài Chrome/Chromium cho Playwright; máy kiểm tra đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` đến Chrome đã cài.

Đăng nhập local vẫn không cần Firebase. Phần dữ liệu đơn hàng giữ backend Firestore hiện có: liên kết phiên local được kiểm tra trên emulator có cấu hình backend đầy đủ, không thay backend này bằng SQLite. Nếu triển khai lên Firebase/Vercel, cần triển khai index mới trong [firestore.indexes.json](../../flower.com/firestore.indexes.json) cho truy vấn đơn theo UID/ngày tạo và TTL bộ đếm; không tự triển khai dịch vụ thật trong đợt sửa này. Nhánh local được gắn danh tính bởi server `npm run dev`; một deployment serverless phải sử dụng lớp xác thực mà deployment đó hỗ trợ.

## Giới hạn còn lại

- Họ tên/số điện thoại có thể được người khác biết; PIN ngắn và câu hỏi cá nhân vẫn không tương đương xác minh sở hữu qua một kênh độc lập. Nếu kẻ xấu biết cả thông tin đối chiếu, họ vẫn có thể tiêu hao lượt PIN theo chính sách 5 lần đã được yêu cầu. Đợt này ngăn trường hợp chỉ biết tên đăng nhập và bổ sung hạn mức, không tuyên bố loại bỏ hoàn toàn rủi ro của thiết kế khôi phục.
- Quy tắc đáp án mạnh áp dụng khi tạo/thiết lập mới. Đáp án cũ được băm nên không thể đánh giá hay tự viết lại thành đáp án mạnh; vẫn được giữ để không làm mất khả năng khôi phục tài khoản cũ. Với tài khoản thực, cần bổ sung passkey/kênh xác minh hoặc mã dùng một lần cùng một lộ trình nâng cấp thông tin khôi phục.
- Đơn hàng dùng số điện thoại do người mua tự khai, chưa có OTP; bot đổi cả nguồn truy cập, số điện thoại và tài khoản vẫn có thể gây lạm dụng. Hạn mức và thời gian giữ hàng ngắn giảm mức độ/tốc độ ảnh hưởng, không thay thế chống gian lận hoặc xác nhận của cửa hàng. Chưa tích hợp CAPTCHA hay dịch vụ OTP bên ngoài.
- Hạn mức HTTP tài khoản local nằm trong bộ nhớ tiến trình và được đặt lại khi restart. Bộ đếm sai mật khẩu/PIN vẫn lưu SQLite; hạn mức tạo đơn nằm trong Firestore. Server local vẫn chỉ hỗ trợ loopback.
- Phép thử XSS và giới hạn tài nguyên có phạm vi đã nêu; chưa kiểm tra tải lớn, hạ tầng CDN/WAF hoặc thanh toán thật.

Script `tests/security-audit/api-probes.cjs` lưu cách tái hiện hành vi **trước sửa** của baseline trong báo cáo gốc; không phải bộ regression cho phiên bản hiện tại. Dùng hai file `security-remediation.test.js` ở trên để kiểm tra bản đã sửa. Kết quả JSON báo cáo gốc được giữ nguyên làm bằng chứng trước sửa.
