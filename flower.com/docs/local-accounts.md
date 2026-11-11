# Tài khoản tự tạo cho bản chạy thử

Trong `flower.com`, chạy `npm run dev` rồi mở `http://127.0.0.1:3000/login.html`.
Mặc định `AUTH_MODE=local`, không cần Firebase, service account hoặc email thật.
Tên đăng nhập cần có `@`, ví dụ `ban@demo`. Ứng dụng không gửi thư hoặc xác minh hộp thư.
Mật khẩu mới cần 8–4096 ký tự, có chữ thường (a–z) và số (0–9); đăng ký phải có họ tên và số điện thoại. Chính sách mới không chặn đăng nhập bằng mật khẩu cũ.

## PIN và câu hỏi khôi phục

Khi đăng ký, người dùng tự đặt:

- PIN gồm **4–6 chữ số**, giữ được số 0 ở đầu, khác mật khẩu; phải nhập xác nhận.
- Đúng **3 câu hỏi khác nhau**, mỗi câu 5–160 ký tự.
- Câu trả lời cho từng câu hỏi, mỗi câu trả lời 2–200 ký tự.

Các ô PIN chỉ nhận chữ số `0–9`, tối đa 6 chữ số; máy chủ từ chối PIN ngắn hơn 4, dài hơn 6,
chứa chữ, khoảng trắng hoặc ký tự khác. PIN được giữ dạng chuỗi để không mất số 0 đầu.
Tài khoản đang dùng PIN dài theo quy tắc cũ phải trả lời 3 câu hỏi để đặt PIN 4–6 số mới;
không tự cắt ngắn PIN cũ, không xóa tài khoản, mật khẩu hay câu hỏi đã có.

PIN và câu trả lời không được hiển thị lại hoặc lưu vào local storage. Câu trả lời được chuẩn hóa
Unicode NFKC, chữ thường và khoảng trắng thừa; dấu tiếng Việt vẫn có ý nghĩa.
Chọn câu trả lời riêng tư, khó đoán; các câu hỏi tự đặt là cơ chế dành cho bản thử local này.

**Đổi PIN:** đăng nhập rồi mở trang **Tài khoản**. Máy chủ kiểm tra tên đăng nhập, họ tên,
số điện thoại, mật khẩu hiện tại và PIN cũ trước khi lưu PIN mới. PIN mới phải khác PIN cũ.
Các phiên đăng nhập khác bị hủy; phiên hiện tại được cấp cookie mới. Ba câu hỏi được giữ nguyên.

**Quên PIN:** tại trang **Quên mật khẩu**, chọn **Tôi quên PIN**, nhập tên đăng nhập để xem
3 câu hỏi. Phải trả lời đúng **cả 3 câu** và xác nhận PIN mới. Không thông báo câu nào đúng/sai.
Thành công sẽ hủy toàn bộ phiên đăng nhập cũ; không đổi mật khẩu hoặc xóa lịch sử khóa đăng nhập.
Sau đó dùng PIN mới để đặt lại mật khẩu nếu cần.

Mỗi lần nhập sai PIN sẽ hiển thị số lượt còn lại: **4, 3, 2, 1, 0**. Sai lần thứ 5 sẽ
**bắt buộc đặt PIN mới bằng 3 câu hỏi**, không tự mở lại PIN cũ sau thời gian chờ.
Trang tự hiển thị 3 câu hỏi; phải trả lời đúng cả 3 và đặt PIN khác PIN cũ mới được tiếp tục.
Đặt lại mật khẩu và đổi PIN dùng chung bộ đếm PIN theo tài khoản; đổi API, IP, tải lại trang,
đăng nhập đúng mật khẩu hoặc khởi động lại máy chủ không xóa yêu cầu đặt PIN mới.

Khôi phục bằng câu trả lời có bộ đếm riêng: mỗi lần sai cũng hiện số lượt còn lại, sai 5 lần
phải chờ 15 phút rồi được thử lại. Các lần sai thông tin họ tên/số điện thoại/mật khẩu khi đổi
PIN (dù PIN đúng) vẫn có giới hạn xác minh riêng 5 lần/15 phút; không tính thành PIN sai.
Nhập sai định dạng không được xác minh. Bộ đếm PIN chỉ được xóa khi xác minh thành công
trước ngưỡng khóa, hoặc sau khi trả lời đúng câu hỏi và đặt PIN mới.

Khi nâng cấp dữ liệu đã có PIN, bộ đếm xác minh cũ được chuyển sang bộ đếm PIN; tài khoản
đã đủ 5 lần sai sẽ chuyển sang yêu cầu đặt PIN mới. Mật khẩu, phiên và lịch sử khóa đăng nhập
được giữ nguyên. Tài khoản cũ chưa có PIN vẫn dùng giới hạn mã khôi phục 5 lần/15 phút.

## Giới hạn đăng nhập

- Sai lần 1–4: báo sai thông tin.
- Sai lần 5: khóa 15 phút.
- Hết thời gian khóa, chỉ được thử một lần; sai tiếp khóa 30, 60, 120 và 240 phút.
- Sau năm lần khóa tạm, lần sai thứ 10 bắt buộc đặt lại mật khẩu.
- Trong thời gian khóa không kiểm tra mật khẩu, kể cả mật khẩu đúng; thử thêm không kéo dài thời hạn.
- Đăng nhập đúng khi được phép thử hoặc đặt lại mật khẩu thành công sẽ xóa lịch sử thất bại.

Bộ đếm theo tài khoản được lưu ở máy chủ. Đổi IP, tab, xóa local storage hoặc khởi động lại máy chủ
không tạo thêm lượt thử. SQLite transaction giữ việc kiểm tra/cập nhật nguyên tử.

## Quên mật khẩu và tài khoản cũ

Chọn **Quên mật khẩu**, nhập tên đăng nhập, PIN và mật khẩu mới khác mật khẩu cũ/PIN.
Đặt lại thành công hủy toàn bộ phiên cũ và mở khóa đăng nhập. **PIN không tự thay đổi**.
Chỉ biết tên đăng nhập không đủ để đặt lại mật khẩu hay gỡ khóa tài khoản.

Tài khoản tạo trước thay đổi này được giữ nguyên cùng mật khẩu, phiên và trạng thái khóa.
Sau khi đăng nhập, vào **Tài khoản → Thiết lập PIN khôi phục**, xác nhận mật khẩu,
bổ sung họ tên/số điện thoại và đặt PIN cùng 3 câu hỏi. Chức năng thiết lập không thể ghi đè
PIN đã có; tài khoản đã thiết lập phải xác minh PIN cũ để đổi.

Nếu tài khoản cũ chưa có PIN và quên mật khẩu, mở **Tài khoản cũ chưa thiết lập PIN?** tại
trang khôi phục để dùng mã khôi phục cũ một lần. Sau đó đăng nhập và thiết lập PIN.
Mã cũ bị vô hiệu hóa ngay khi dùng hoặc khi thiết lập PIN; không có đường dùng mã cũ để bỏ qua PIN.
Tài khoản chưa đặt câu hỏi không thể dùng luồng quên PIN.

## Lưu trữ và phạm vi

- Dữ liệu ở `.tools/local-auth/accounts.sqlite`, bị Git bỏ qua và không được phục vụ qua HTTP.
- Mật khẩu, PIN và từng câu trả lời được băm scrypt với salt riêng; mã phiên chỉ lưu SHA-256.
  PIN/câu trả lời dùng `N=32768, r=8, p=3`; mật khẩu cũ giữ cấu hình tương thích `p=1`.
- Cookie phiên `HttpOnly`, `SameSite=Strict`, sống 12 giờ. Local storage chỉ chứa bản sao hồ sơ,
  không phải bằng chứng xác thực hoặc nguồn cấp quyền. Tài khoản local chỉ có quyền khách hàng.
- Các trang tài khoản local hoạt động mà không tải SDK Firebase cho xác thực.
- Đây là máy chủ Node trên loopback cho bản thử. Catalog, đơn hàng và quản trị vẫn theo kiến trúc
  riêng của dự án. Tài khoản Firebase thuộc kho riêng; bản Vercel hiện có vẫn dùng chế độ Firebase.

Không xóa file SQLite nếu muốn giữ tài khoản và trạng thái khóa. Đổi giữa `localhost` và `127.0.0.1`
có thể cần đăng nhập lại do cookie gắn với hostname. Live Server chỉ phục vụ HTML, không chạy API này.

## Kiểm thử

`npm test` kiểm tra chính sách khóa, PIN, 3 câu trả lời, chuyển dữ liệu cũ, lưu sau khởi động,
phiên và API HTTP. `npm run test:e2e:local` kiểm tra đăng ký, đổi PIN, quên PIN, đổi mật khẩu,
đăng nhập/đăng xuất và hồ sơ trên desktop/mobile, không cần Firebase Emulator hoặc Java.
