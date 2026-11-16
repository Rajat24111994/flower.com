# Rà soát bảo mật ứng dụng FlowerFlow — 09/11/2026

Đây là kết quả **trước sửa**. Xem [các biện pháp đã áp dụng và kết quả kiểm thử lại](2026-11-09-security-remediation.md) để biết trạng thái hiện tại. Script tái hiện API bên dưới dùng cho baseline; kiểm thử bản sửa nằm trong báo cáo mới.

Phạm vi: đăng nhập/khôi phục tài khoản, sản phẩm, giỏ hàng, checkout, tạo đơn, tra cứu đơn và thanh toán. Mã nguồn tại commit `ac0fb9bcf595d31e436b529e3833b382b3b12fe5`. Đây là báo cáo kiểm tra và đề xuất khắc phục; chưa sửa hành vi của ứng dụng.

## Kết quả kiểm tra

| Nhóm kiểm tra | Kết quả thực tế |
| --- | --- |
| Unit và kiểm thử HTTP/local hiện có | **154/154 đạt**, không bỏ qua ca nào; gồm kiểm tra PIN, khôi phục, khóa đăng nhập, dữ liệu biểu mẫu và bảo vệ local server. |
| API, phân quyền Firestore, đơn hàng và VNPay | **56/56 đạt**, không bỏ qua ca nào. Chạy handler thật và rules thật trên emulator. |
| Khóa đăng nhập Firebase | **3/3 đạt**: cộng số lần sai theo tài khoản dù thay IP; xử lý yêu cầu đồng thời; khóa tăng dần và chỉ mở sau khi hoàn tất đổi mật khẩu. |
| XSS trên trình duyệt | **42/42 đạt**: 3 payload × 7 trang × 2 kích thước màn hình. Không payload nào thực thi; không tạo phần tử HTML từ payload. |
| Thăm dò bổ sung | Ghi nhận **9 quan sát** về khôi phục, tài nguyên máy chủ, tồn kho, danh tính đặt đơn và quyền quản trị; chi tiết dưới đây. Đây là quan sát rủi ro, không phải 9 ca kiểm thử bảo mật đạt. |

42 kiểm tra XSS dùng Chrome headless ở 1280×800 và 390×844, qua trang đăng nhập, chi tiết sản phẩm, giỏ hàng, checkout, xác nhận đặt hàng, tra cứu đơn và kết quả thanh toán. Payload đi qua thông báo lỗi API, dữ liệu sản phẩm, giỏ hàng và thông tin đơn giả lập. Dữ liệu được hiển thị như văn bản. Đọc mã nguồn cũng cho thấy các vị trí này dùng `textContent`, ví dụ [login.js](../../flower.com/js/account/login.js#L90), [product.js](../../flower.com/js/catalog/product.js#L618), [cart.html](../../flower.com/cart.html#L172), [checkout.html](../../flower.com/checkout.html#L532), [placeorder.html](../../flower.com/placeorder.html#L97), [tracking.js](../../flower.com/js/order/tracking.js#L304), [payment-result.js](../../flower.com/js/order/payment-result.js#L12).

Các bảo vệ đã xác nhận bằng kiểm thử:

- Người dùng Firebase khác không đọc được đơn của chủ tài khoản qua API hoặc Firestore; tra cứu công khai được lược bỏ thông tin cá nhân. Token giả hoặc bị thu hồi không tạo đơn dưới danh tính người khác.
- Giá, giảm giá, phí và tồn kho được kiểm tra phía máy chủ. Sửa giá client, số lượng bất thường, ghi chú trên 500 ký tự, sản phẩm ẩn hoặc không đủ hàng bị từ chối. Idempotency ngăn gửi lại cùng yêu cầu tạo nhiều đơn.
- Khách không trực tiếp tạo/sửa đơn hay tự xác nhận thanh toán trong Firestore. Đối soát QR cần quyền admin; VNPay kiểm tra chữ ký và số tiền. Tham số thành công trên URL không đủ để xác nhận đã thanh toán.
- Local server giới hạn Host/Origin, kích thước body và chặn truy cập tệp riêng; cookie phiên local có HttpOnly/SameSite. PIN phải là 4–6 chữ số ASCII, được kiểm tra ở máy chủ; secret được băm có salt.

## Danh sách rủi ro và hướng xử lý

### SEC-01 — Giữ hết tồn kho bằng đơn COD ẩn danh

**Mức độ: Cao nếu API đặt hàng được mở ra Internet. Đã tái hiện trên emulator.**

- Vị trí: [orders.js:703](../../flower.com/api/orders.js#L703), [orders.js:848](../../flower.com/api/orders.js#L848), [orders.js:887](../../flower.com/api/orders.js#L887); thời gian giữ COD 24 giờ tại [orders.js:13](../../flower.com/api/orders.js#L13).
- Bằng chứng: không có token vẫn tạo được đơn COD lấy toàn bộ 10 sản phẩm fixture, HTTP `201`; tồn kho về `0`; giữ hàng 24 giờ; báo giá cho khách kế tiếp trả `409`. Ba đơn mới liên tiếp với idempotency key khác nhau đều trả `201`.
- Ảnh hưởng: kẻ xấu có thể tạo đơn giả để hàng không còn khả dụng cho người mua thật. Idempotency chỉ ngăn gửi trùng cùng yêu cầu; giới hạn tra cứu hiện có không giới hạn tạo đơn.
- Khắc phục: đặt quota tạo đơn/giữ hàng theo nhiều tín hiệu như tài khoản, phiên, số điện thoại và nguồn truy cập; áp dụng thử thách khi có dấu hiệu tự động hóa; giới hạn số đơn chưa xác nhận. Tách giữ hàng ngắn hạn với giữ hàng COD đã được cửa hàng xác nhận. Với website không dùng email thật, không lấy chuỗi có `@` làm bằng chứng danh tính đã xác minh.
- Kiểm tra sau sửa: vượt quota phải bị chặn trước khi trừ kho; đổi idempotency key không vượt được quota; đơn hợp lệ và hoàn kho khi hết hạn vẫn hoạt động.

### SEC-02 — Câu trả lời bảo mật yếu có thể dẫn đến chiếm tài khoản

**Mức độ: Trung bình; phụ thuộc người dùng chọn câu trả lời dễ đoán. Đã tái hiện với dữ liệu thử.**

- Vị trí: [local-accounts.js:45](../../flower.com/lib/local-accounts.js#L45), [local-accounts.js:174](../../flower.com/lib/local-accounts.js#L174), [local-accounts.js:204](../../flower.com/lib/local-accounts.js#L204).
- Bằng chứng: đăng ký ba câu hỏi khác nhau nhưng cùng câu trả lời `12` được chấp nhận. Người không có phiên đăng nhập đoán ba đáp án đó, đổi PIN, dùng PIN mới đặt lại mật khẩu và đăng nhập bằng mật khẩu mới; cả ba bước trả `200`.
- Giới hạn kết luận: không chứng minh có thể vượt qua mọi tài khoản hoặc đoán được đáp án mạnh. Đây là điểm yếu của bằng chứng khôi phục được chấp nhận, không phải lỗi so sánh hash. Cơ chế trả lời sai đã có khóa 15 phút sau 5 lần.
- Khắc phục: chặn đáp án phổ biến, ngắn hoặc trùng nhau; hướng dẫn chọn bí mật khó đoán. Khi dùng cho tài khoản thật, bổ sung bằng chứng sở hữu mạnh như passkey, kênh đã xác minh hoặc mã khôi phục ngẫu nhiên dùng một lần. PIN 4–6 số và câu hỏi cá nhân không nên là toàn bộ cơ chế bảo vệ tài khoản thật. Không tự đổi yêu cầu PIN hiện tại trong đợt rà soát này.
- Kiểm tra sau sửa: từ chối bộ đáp án yếu; không đặt lại PIN/mật khẩu khi thiếu bằng chứng mới; vô hiệu phiên cũ sau khôi phục thành công.

### SEC-03 — Người ngoài có thể buộc chủ tài khoản phải khôi phục PIN

**Mức độ: Trung bình trong phạm vi dịch vụ local; rủi ro thiết kế của chính sách đã thống nhất. Đã tái hiện.**

- Vị trí: [local-accounts.js:126](../../flower.com/lib/local-accounts.js#L126), [local-accounts.js:131](../../flower.com/lib/local-accounts.js#L131), [local-accounts.js:174](../../flower.com/lib/local-accounts.js#L174).
- Bằng chứng: chỉ biết tên đăng nhập, gửi 5 yêu cầu đặt lại mật khẩu với PIN sai, không cần phiên đăng nhập. Mã trả về là `401, 401, 401, 401, 403`. Sau đó nhập đúng PIN vẫn trả `403 / pin-reset-required` và phải trả lời câu hỏi.
- Ảnh hưởng: gây gián đoạn khả năng khôi phục của chủ tài khoản. Phép thử này không chứng minh các phiên đang đăng nhập bị khóa hoặc mật khẩu đúng không đăng nhập được.
- Khắc phục: giữ nguyên quy tắc 5 lần nếu vẫn cần, nhưng bổ sung giới hạn theo nguồn/phiên, thử thách và thời gian chờ trước khi cho phép thử tiếp. Cân nhắc chỉ tính vào ngưỡng bắt buộc đổi PIN sau một bước xác minh. Giới hạn theo IP chỉ là lớp bổ sung, không thay thế giới hạn theo tài khoản.
- Kiểm tra sau sửa: nguồn gây lỗi không thể liên tục làm gián đoạn tài khoản; chủ tài khoản vẫn có đường khôi phục hợp lệ; thông báo số lượt còn lại đúng.

### SEC-04 — Băm đồng bộ ở đăng ký làm nghẽn máy chủ, kể cả tên đã tồn tại

**Mức độ: Trung bình; hiện server local chỉ chấp nhận truy cập loopback. Đã tái hiện với hai yêu cầu.**

- Vị trí: [local-accounts.js:11](../../flower.com/lib/local-accounts.js#L11), [local-accounts.js:45](../../flower.com/lib/local-accounts.js#L45), [local-accounts.js:142](../../flower.com/lib/local-accounts.js#L142).
- Bằng chứng: băm ba đáp án bằng `scryptSync` xảy ra trước kiểm tra trùng tên đăng nhập. Hai yêu cầu đăng ký trùng đều trả `409`, nhưng yêu cầu tải trang đồng thời mất khoảng **1.388 ms**, so với **3 ms** lúc rảnh trên máy thử.
- Giới hạn kết luận: đây là phép đo cục bộ nhỏ, không phải benchmark chịu tải hay bằng chứng tấn công từ Internet vào server loopback.
- Khắc phục: tách kiểm tra dữ liệu khỏi băm; kiểm tra trùng trước xử lý tốn CPU và vẫn giữ ràng buộc UNIQUE chống race. Dùng băm bất đồng bộ/worker với giới hạn số tác vụ chờ và rate limit đăng ký. Đánh giá cả các API dùng băm đồng bộ khác. Không giảm độ mạnh scrypt để che vấn đề.
- Kiểm tra sau sửa: yêu cầu trùng không băm lại câu trả lời; tải CPU không làm chặn event loop; không tạo tài khoản trùng khi đồng thời.

### SEC-05 — Dò được tài khoản và đọc công khai tiêu đề câu hỏi khôi phục

**Mức độ: Thấp trong chế độ local hiện tại. Đã tái hiện.**

- Vị trí: [local-accounts.js:197](../../flower.com/lib/local-accounts.js#L197).
- Bằng chứng: endpoint `questions` không yêu cầu phiên, trả `200` và ba câu hỏi cho tên có thật, `401` cho tên không tồn tại. Khi chưa bị khóa đáp án, không có hạn mức riêng cho việc lấy danh sách câu hỏi.
- Ảnh hưởng: xác nhận tên tài khoản để nhắm mục tiêu; tiêu đề câu hỏi tự đặt có thể chứa thông tin cá nhân. Chưa có bằng chứng lộ câu trả lời hay hash qua endpoint này.
- Khắc phục: thống nhất phản hồi cho tài khoản có/không tồn tại, thêm giới hạn/thử thách ở bước bắt đầu khôi phục; chỉ hiển thị câu hỏi sau bước xác minh phù hợp. Cần thiết kế lại cả luồng để tránh dùng khác biệt nội dung câu hỏi làm kênh dò tài khoản.
- Kiểm tra sau sửa: status/body/thời gian không dễ phân biệt tên có thật; endpoint không trả câu hỏi trước bước xác minh quy định.

### SEC-06 — API dọn đơn dùng claim admin cũ, thiếu kiểm tra quyền hiện hành

**Mức độ: Thấp; chỉ xảy ra khi có token admin cũ còn hợp lệ sau khi xóa quyền trong Firestore và chưa thu hồi token thành công. Đã tái hiện điều kiện này.**

- Vị trí: [orders.js:1231](../../flower.com/api/orders.js#L1231), đối chiếu helper kiểm tra quyền hiện hành [orders.js:320](../../flower.com/api/orders.js#L320). Luồng thu hồi tại [owner/users.js:99](../../flower.com/api/owner/users.js#L99).
- Bằng chứng: xóa `adminRoles/{uid}` nhưng giữ ID token admin chưa bị thu hồi; gọi `GET /api/orders?action=expire` trả `200`, trong khi thao tác đối soát QR với cùng token trả `403`.
- Giới hạn ảnh hưởng: mới xác nhận quyền kích hoạt dọn các reservation đã hết hạn; chưa chứng minh đọc được đơn riêng, xác nhận tiền hoặc hủy tùy ý đơn chưa hết hạn. Luồng thu hồi bình thường có gọi `revokeRefreshTokens`; `verifyIdToken(..., true)` vẫn chặn token đã thu hồi thành công.
- Khắc phục: nhánh người quản trị sử dụng chung helper kiểm tra cả token và `adminRoles`; giữ nhánh cron secret riêng. Không chỉ dựa vào custom claim còn thời hạn.
- Kiểm tra sau sửa: xóa role là mất quyền ngay, kể cả mô phỏng lỗi thu hồi token; cron hợp lệ vẫn chạy được.

### SEC-07 — CSP còn cho phép script inline

**Mức độ: Thấp, tăng cường phòng thủ; không phải XSS đã khai thác được.**

- Vị trí: [vercel.json:8](../../flower.com/vercel.json#L8); [local-server.js:63](../../flower.com/lib/local-server.js#L63).
- Bằng chứng: cấu hình Vercel có `script-src 'unsafe-inline'`. Trang fixture áp dụng đúng header này vẫn chạy được script inline lành tính. Phản hồi HTML từ server local không có CSP; vẫn có `X-Frame-Options: DENY` và `nosniff`.
- Khắc phục: chuyển các script inline tĩnh ra tệp hoặc cấp hash/nonce phù hợp, rồi bỏ `unsafe-inline` cho script. Thử chính sách bằng Report-Only trước khi áp dụng chặn; thêm chính sách phù hợp cho local. Tiếp tục dùng `textContent`/mã hóa đầu ra, không dùng CSP thay cho xử lý dữ liệu an toàn.
- Kiểm tra sau sửa: script không được cấp phép bị chặn, các trang và Firebase SDK hợp lệ vẫn hoạt động. `style-src 'unsafe-inline'` là vấn đề riêng, không đồng nhất với script.

### INT-01 — Phiên tài khoản local chưa được API đơn hàng sử dụng

**Khoảng trống tích hợp; chưa chứng minh được truy cập trái phép hoặc lộ thông tin đơn. Cần xử lý trước khi dùng tài khoản local cho đơn hàng thật.**

- Vị trí: [order-store.js:203](../../flower.com/js/order/order-store.js#L203), [order-store.js:210](../../flower.com/js/order/order-store.js#L210), [orders.js:694](../../flower.com/api/orders.js#L694), [orders.js:848](../../flower.com/api/orders.js#L848).
- Bằng chứng: cookie phiên local hợp lệ được gửi cùng yêu cầu tạo đơn, nhưng handler chỉ xác thực Firebase bearer token; đơn được tạo `201` với `uid: ""`, thay vì UID local. Thử trên backend Firestore emulator có cấu hình đầy đủ. Không suy ra server local thiếu cấu hình Firebase hiện tại vẫn lưu được đơn.
- Ảnh hưởng: đơn của khách đã đăng nhập local bị xem như đơn khách vãng lai; không có liên kết sở hữu tài khoản như luồng Firebase. Rules vẫn không cho tài khoản khác đọc đơn này chỉ bằng cách đổi UID.
- Khắc phục: thống nhất lớp xác thực phía máy chủ cho các API, lấy danh tính từ phiên đã kiểm chứng, rồi lưu UID người tạo. Nếu chỉ hỗ trợ local, cần một backend đơn hàng/phân quyền tương ứng. Không lấy `loggedUser` trong localStorage hoặc `uid` do client gửi làm bằng chứng quyền sở hữu. Khi có thông tin phiên không hợp lệ, tránh âm thầm hạ thành khách vãng lai.
- Kiểm tra sau sửa: đơn gắn đúng tài khoản local; tài khoản khác bị từ chối; cookie giả/hết hạn bị chặn; luồng khách vãng lai được kiểm soát riêng.

## Môi trường và giới hạn

- Node.js 24.22.1; Chrome headless; Firebase Auth/Firestore emulator với project `demo-security-audit`. Tài khoản local trong phép thăm dò dùng SQLite trong bộ nhớ. Không tấn công Firebase thật, không tạo giao dịch ngân hàng, không dùng dữ liệu khách thật.
- Kiểm thử tích hợp gọi handler API thật trong tiến trình và rules trên emulator; không kiểm tra lớp bảo vệ CDN/WAF hay cấu hình triển khai thực tế. Các rủi ro không giới hạn lưu lượng được xác nhận ở mã ứng dụng; chưa biết có quota ở hạ tầng triển khai hay không.
- Kiểm thử XSS chạy HTML/script giao diện thật với dữ liệu kho hàng/đơn hàng và SDK phản hồi giả lập; bước kiểm tra phiên trong header được bỏ qua trong fixture để giữ dữ liệu tài khoản giả. Do đó đây là kiểm tra đường hiển thị DOM, không phải kiểm thử toàn bộ đăng nhập hoặc lưu XSS qua backend production.
- Kết quả XSS chỉ bao phủ payload và đường đi đã thử; không bảo đảm ứng dụng không có XSS ở mọi trang, mọi trình duyệt hoặc màn hình quản trị. Đã đọc các chỗ `innerHTML` liên quan; chưa xác nhận đường chèn mã thực thi trong phạm vi rà soát.
- Hai yêu cầu đăng ký trùng, năm lần PIN sai và bốn đơn ẩn danh dùng dữ liệu thử là lượng thăm dò nhỏ; không thực hiện stress test.
- Danh sách trên gồm **7 rủi ro/hạng mục tăng cường bảo vệ và 1 khoảng trống tích hợp**. Một số mục là đánh đổi của cơ chế khôi phục đã được yêu cầu, không phải thay đổi tự ý trong đợt kiểm tra.

## Chạy lại và bằng chứng

Từ thư mục gốc repository, sau khi cài dependency của ứng dụng và thư mục `tests`, khởi động Auth/Firestore emulator ở terminal riêng:

```powershell
Set-Location flower.com
node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only auth,firestore --project demo-security-audit --config firebase.json --non-interactive
```

Cần Java phù hợp với phiên bản Firebase Tools đang dùng. Trên máy kiểm tra đã dùng Java đi kèm PyCharm. Khi có sẵn emulator jar ở `.tools/emulators`, có thể đặt `FIREBASE_EMULATORS_PATH` trỏ đến thư mục đó. Không dùng lại cổng emulator đang phục vụ công việc khác.

Terminal tại thư mục gốc:

```powershell
npm.cmd --prefix flower.com test
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-security-audit'
node --test --test-concurrency=1 tests/integration/security-api.test.js tests/integration/security-rules.test.js tests/integration/feature-accounts.test.js tests/integration/feature-orders.test.js tests/integration/vnpay.test.js tests/integration/login-protection.test.js
node tests/security-audit/api-probes.cjs
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tests/security-audit/browser-probes.cjs
```

Chạy các kiểm thử dùng cùng project emulator **lần lượt**: helper sẽ xóa dữ liệu project thử. Helper từ chối chạy nếu thiếu emulator hoặc project không bắt đầu bằng `demo-`. Không trỏ biến emulator tới dịch vụ thật. Nếu dùng Chromium đã cài bởi Playwright, có thể bỏ biến đường dẫn Chrome.

- [api-probes.cjs](../../tests/security-audit/api-probes.cjs): tái hiện các quan sát API; dùng cho rà soát revision hiện tại, không phải regression test yêu cầu giữ nguyên hành vi có rủi ro.
- [browser-probes.cjs](../../tests/security-audit/browser-probes.cjs): kiểm tra đường hiển thị DOM và fixture CSP.
- [security-audit-results.json](2026-11-09-security-audit-results.json): bản lưu kết quả máy đọc được của lần chạy này.
- Log thô trên máy tại `flower.com/.tools/security-audit-{integration,login-integration,unit,api,browser}.log` (được gitignore). Kết quả JSON gốc cũng nằm trong `.tools`.

## Cơ sở cho đề xuất

- [OWASP — Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): phản hồi thống nhất, hạn chế yêu cầu tự động và bằng chứng khôi phục phù hợp; tránh biến khôi phục thành cách gây khóa tài khoản.
- [OWASP — Security Questions](https://cheatsheetseries.owasp.org/cheatsheets/Choosing_and_Using_Security_Questions_Cheat_Sheet.html): câu hỏi cá nhân không nên là bằng chứng duy nhất cho khôi phục tài khoản; cần hạn chế câu trả lời dễ đoán.
- [Node.js — Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop): công việc CPU đồng bộ trên event loop có thể chặn phục vụ các yêu cầu khác.
- [OWASP — Bot Management](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html): kết hợp hạn mức và biện pháp chống tự động hóa theo hành vi.
- [OWASP — XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) và [CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html): dùng đầu ra đúng ngữ cảnh; CSP nghiêm ngặt là lớp phòng thủ bổ sung.
