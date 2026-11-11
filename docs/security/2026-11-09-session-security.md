# Bảo vệ phiên đăng nhập tài khoản local — 09/11/2026

Áp dụng cho tài khoản tự tạo bằng tên có `@`, đang chạy với `AUTH_MODE=local`. Không yêu cầu cài đặt hay cấu hình Firebase cho đăng nhập local. Thay đổi được thực hiện sau commit `d338499`.

## Chính sách phiên và thay đổi

- **Thời hạn tuyệt đối 12 giờ**, tính từ khi đăng nhập hoặc cấp phiên mới. Máy chủ kiểm tra `expires_at > now()` trong SQLite; đúng thời điểm hết hạn là bị từ chối. Tải lại trang hay gọi API xem phiên không gia hạn thời gian. Thời hạn này dùng chung một hằng số với `Max-Age` cookie.
- **Đăng xuất có thu hồi phía máy chủ**: xóa hash token khỏi SQLite rồi mới trả thành công và xóa cookie. Dùng lại cookie đã sao chép sẽ bị từ chối ở API tài khoản. Đăng xuất lặp lại vẫn an toàn. GET hoặc yêu cầu khác Origin không làm đăng xuất.
- **Đăng nhập lại xoay vòng token**: đăng nhập/đăng ký thành công sẽ thu hồi token cũ được trình duyệt gửi lên trước khi cấp token ngẫu nhiên mới. Đăng nhập sai không làm mất phiên còn hợp lệ. Các thiết bị khác giữ phiên riêng; đổi PIN và khôi phục tài khoản vẫn thu hồi các phiên của tài khoản theo cơ chế hiện có.
- **Khôi phục rồi xóa cookie cũng thu hồi token tương ứng**: nếu trình duyệt đang giữ phiên của tài khoản A nhưng khôi phục tài khoản B, token A được gửi cùng yêu cầu cũng bị xóa cùng transaction thay vì chỉ xóa bản cookie phía trình duyệt. Các phiên thuộc B bị thu hồi; phiên A trên thiết bị khác không bị ảnh hưởng.
- **Cookie rõ phạm vi và thời gian**: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, `Expires`; không đặt `Domain` nên cookie thuộc đúng host. Khi hết hạn/không hợp lệ, cookie được xóa bằng `Max-Age=0` và ngày hết hạn trong quá khứ. Tên cookie trùng lặp bị từ chối khi xác thực; đăng xuất thu hồi tất cả token được trình duyệt gửi trong các cookie trùng đó.
- **`Secure` khi kết nối TLS thật**: dùng `req.socket.encrypted`, không tin `X-Forwarded-Proto` do client tự gửi. Server thử nghiệm hiện chạy HTTP loopback nên không ép `Secure` làm hỏng đăng nhập localhost trên một số trình duyệt. Host/Origin và địa chỉ bind của server local vẫn được giới hạn. Khi dùng cookie trên dịch vụ công khai phải chạy HTTPS và cấu hình đúng lớp kết thúc TLS; phép thử này không triển khai TLS hoặc reverse proxy mới.
- **Giao diện không dùng hồ sơ lưu sẵn làm bằng chứng đăng nhập**: trang Tài khoản ẩn nội dung đến khi xác minh thành công. Không xác minh được thì xóa bản sao hồ sơ và yêu cầu đăng nhập lại. Không tiếp tục hiển thị hồ sơ từ localStorage sau lỗi API.
- **Hết hạn và đăng xuất ở tab khác**: bộ theo dõi dùng thời điểm hết hạn do máy chủ trả về, đồng bộ sự kiện storage và kiểm tra lại khi tab được mở/focus, trở lại từ bộ nhớ Back/Forward, hoặc mỗi 60 giây khi đang hiển thị. Vô hiệu hóa phía máy chủ luôn có hiệu lực với yêu cầu API tiếp theo; giao diện không phải lớp thực thi quyền.
- **Xóa nội dung nhạy cảm khi rời trang/đăng xuất**: che và xóa nội dung hồ sơ/PIN trên DOM trước khi trang được lưu lại; dọn bản sao đăng nhập và thông tin checkout đang chờ khi phiên mất hiệu lực. Các trang dùng header và trang tra cứu đơn nhận thông báo phiên kết thúc để bỏ nội dung riêng tư. Khi logout lỗi mạng/API, giao diện hiển thị lỗi và cho thử lại, không báo đã đăng xuất thành công.

Token vẫn là 32 byte ngẫu nhiên; chỉ hash SHA-256 được lưu trong bảng phiên, cookie HttpOnly giữ token thật. API không trả token trong JSON hoặc dùng `loggedUser` làm bằng chứng quyền truy cập. `sessionExpiresAt` trong hồ sơ chỉ phục vụ giao diện và không thể thay đổi hạn trong SQLite.

Các nguyên tắc kiểm tra hạn và hủy phiên ở máy chủ phù hợp [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Ý nghĩa thuộc tính cookie và khác biệt `Secure` trên localhost được mô tả trong [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) và [MDN Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies).

## Kiểm thử và bằng chứng

| Bộ kiểm tra | Kết quả |
| --- | --- |
| Unit/HTTP/SQLite toàn dự án | **169/169 đạt**, không bỏ qua ca nào; gồm 7 ca bảo vệ phiên mới |
| Coverage dòng / nhánh / hàm | **58,86% / 80,85% / 82,11%**, đạt ngưỡng CI 50% dòng |
| Tài khoản và phiên local trên desktop/mobile | **24/24 đạt**, gồm 10 ca phiên mới và 14 ca PIN/tài khoản hiện có |
| Tương thích giao diện Firebase dùng mock | **12/12 đạt**; không kiểm tra thu hồi token trên Firebase thật |

- [Kiểm thử HTTP/SQLite](../../tests/session-security.test.js): ranh giới 12 giờ chính xác, không gia hạn khi đọc, phát lại cookie cũ vào API bảo vệ, xoay vòng khi đăng nhập lại, logout idempotent, chặn GET/khác Origin, cookie trùng, thu hồi khi khôi phục và sau khi mở lại database.
- Nhánh phát/xóa cookie HTTPS được kiểm tra với transport TLS giả lập ở mức handler; localhost HTTP được kiểm tra qua HTTP thật. Không tuyên bố đã chạy trình duyệt trên một deployment HTTPS thật.
- [Kiểm thử trình duyệt](../../flower.com/e2e/local-session.spec.js): hết hạn 12 giờ bằng đồng hồ kiểm soát, hai tab đăng xuất, Back/Forward, lỗi xác minh phiên, logout thất bại và phát lại cookie ở API tài khoản. Đồng hồ thử thuộc fixture trong tiến trình kiểm thử, không có API công khai để đổi giờ máy chủ.
- Các luồng PIN và khôi phục cũ được chạy lại cùng bộ local; tương thích giao diện Firebase được kiểm tra bằng SDK/API giả lập, không liên hệ tài khoản Firebase thật.

Log cục bộ: `flower.com/.tools/session-unit-final.log`, `session-browser-final.log`, `session-firebase-compatibility.log`; coverage ở `flower.com/coverage/lcov.info`. [Kết quả JSON](2026-11-09-session-security-results.json) được lưu cùng thư mục báo cáo.

## Chạy lại

```powershell
Set-Location flower.com
npm.cmd run test:coverage
npm.cmd run test:e2e:local
```

Nếu dùng Chrome đã cài trên máy, đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` trước khi chạy Playwright. Kiểm thử dùng SQLite riêng/in-memory; không xóa database tài khoản đang dùng. Chạy `npm run dev` lại để nạp mã máy chủ mới; cookie phiên cũ còn trong thời hạn vẫn được kiểm tra bằng bảng phiên hiện có.

## Giới hạn phạm vi

Thời hạn 12 giờ là thời hạn tuyệt đối, không bổ sung timeout do ngừng thao tác. Đăng xuất một trình duyệt không đăng xuất các thiết bị khác; các tab cùng cookie được cập nhật đồng bộ. Nếu người dùng chặn storage hoặc tab bị trình duyệt treo, cập nhật hình ảnh có thể chờ tới lúc tab hoạt động lại; API vẫn từ chối token không hợp lệ ngay khi xử lý yêu cầu mới.

Nhánh Firebase tùy chọn vẫn dùng cơ chế token/đăng xuất của Firebase SDK. Đợt này không bổ sung server session cookie, thời hạn 12 giờ hay endpoint thu hồi ID token cho Firebase; các kiểm thử Firebase chỉ xác nhận tương thích giao diện. Chính sách và tiêu chí thu hồi phiên trong báo cáo này áp dụng cho tài khoản local đang sử dụng.
