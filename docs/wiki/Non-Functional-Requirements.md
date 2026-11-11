<div align="center">

# ⚡ Yêu cầu phi chức năng

**Hệ thống phải chạy ổn định, nhanh, an toàn và dễ sửa đến mức nào**

[🏠 Trang chủ](Home) · [📋 Yêu cầu chức năng](Functional-Requirements) · [🏛️ Kiến trúc phần mềm](Software-Architecture-Document)

</div>

---

Mỗi yêu cầu có cột **Hiện trạng** cho biết hệ thống hiện tại đã đáp ứng tới đâu:
✅ Đạt · ⚠️ Đạt một phần · ❌ Chưa đạt

Xem [ma trận truy vết KH/QT/NF](Traceability-Matrix.md) để biết test nào thực sự kiểm tra từng chỉ tiêu và những bằng chứng còn thiếu. Test chức năng/CI xanh không tự chứng minh các ngưỡng uptime, tải hoặc độ trễ trong bảng dưới.

## 🟢 Sẵn sàng và tin cậy

| Mã | Yêu cầu | Chỉ tiêu | Hiện trạng |
| --- | --- | --- | --- |
| NF‑01 | Hoạt động liên tục | Chạy 24/7, uptime ≥ 99,9% | ⚠️ Chạy trên Vercel và Firebase; chưa có công cụ đo uptime |
| NF‑02 | Chịu tải dịp lễ | Ổn định khi lượng truy cập tăng 10–20 lần (14/2, 8/3, 20/10) | ❌ Chưa kiểm thử tải |
| NF‑03 | Sao lưu tự động | Sao lưu dữ liệu mỗi ngày | ⚠️ Đã có, cần chủ repo thêm 2 secret trên GitHub để bắt đầu chạy |
| NF‑04 | Khôi phục dữ liệu | Khôi phục được từ bản sao lưu | ✅ Có lệnh khôi phục và test tự động |

![Sao lưu và khôi phục](https://raw.githubusercontent.com/Longg5048/flower.com/main/docs/wiki/sao-luu.png)

## 🚀 Hiệu năng

| Mã | Yêu cầu | Chỉ tiêu | Hiện trạng |
| --- | --- | --- | --- |
| NF‑05 | Tải trang chọn hoa | ≤ 5 giây | ✅ Điểm Lighthouse trang sản phẩm ≥ 90 |
| NF‑06 | Xử lý thanh toán | ≤ 5 giây, không tính thời gian chờ ngân hàng | ⚠️ VNPay đã tích hợp; chưa đo thời gian |
| NF‑07 | Đồng bộ tồn kho | Website và trang quản trị cập nhật trong ≤ 10 giây | ✅ Cập nhật trực tiếp từ Firestore |
| NF‑08 | Không bán vượt kho | An toàn khi nhiều người mua cùng lúc | ✅ Kiểm tra và trừ kho trong cùng một giao dịch; có test |

## 🔒 Bảo mật

| Mã | Yêu cầu | Chỉ tiêu | Hiện trạng |
| --- | --- | --- | --- |
| NF‑09 | Thanh toán an toàn | Không lưu thông tin thẻ; kết quả thanh toán phải xác thực được | ✅ Thẻ do VNPay xử lý; kết quả có chữ ký HMAC-SHA512 |
| NF‑10 | Giá không bị sửa | Tiền hàng do máy chủ tính | ✅ Máy chủ tính lại giá, ưu đãi, phí giao trước khi tạo đơn |
| NF‑11 | Mật khẩu mạnh | Mật khẩu mới có 8–4096 ký tự, chữ thường (a–z) và số (0–9) | ⚠️ Đã kiểm tra trên form đăng ký/đặt lại và API local; chưa xác minh Password Policy Firebase production |
| NF‑12 | Phân quyền | Khách, quản lý, chủ cửa hàng chỉ làm được việc của mình | ✅ Kiểm tra ở máy chủ và Firestore Rules; có test |
| NF‑13 | Thao tác nhạy cảm | Chỉ chủ cửa hàng được cấp quyền và giảm giá lớn | ⚠️ Chỉ chủ cấp quyền; nhưng quản lý vẫn tạo được ưu đãi tới 100% |

## 🛠️ Bảo trì

### Chính sách mật khẩu và đánh giá MFA — issue #121 (11/11/2026)

Form đăng ký và đặt lại mật khẩu local dùng cùng chính sách với máy chủ local; đăng nhập vẫn chấp nhận mật khẩu cũ. Không thay thuật toán băm của tài khoản local và không tự băm mật khẩu Firebase. Trang đặt lại mật khẩu Firebase dùng email dẫn tới giao diện do Firebase quản lý, nên phải bật chính sách ở dịch vụ để chống bỏ qua kiểm tra trình duyệt.

Chủ repo cần vào Firebase Console → Authentication → Settings → Password policy: chọn **Require**, minimum length **8**, maximum **4096**, **Lowercase character required** và **Numeric character required**. Không bật force upgrade on sign-in trong đợt này để tránh khóa luồng đăng nhập cũ. Chữ hoa/ký tự đặc biệt được khuyến khích nhưng chưa bắt buộc. Chưa có bằng chứng cấu hình production đã được lưu; không coi kiểm tra form là thay thế cho chính sách Firebase. Xem [hướng dẫn chính thức](https://firebase.google.com/docs/auth/web/password-auth).

Kết luận MFA: đề xuất TOTP cho admin/owner sau khi nâng Firebase Authentication lên Identity Platform và xác nhận chi phí/hạn mức phù hợp. [Firebase yêu cầu email đã xác minh và luồng đăng ký/xác thực yếu tố thứ hai](https://firebase.google.com/docs/auth/web/totp-mfa). PIN và câu hỏi khôi phục local hiện có không phải MFA của Firebase.

Chưa bật MFA trong issue này. Luồng đăng nhập mật khẩu hiện đi qua API máy chủ rồi tạo custom token; custom auth tokens không hỗ trợ MFA theo tài liệu Firebase, nên không thể chỉ bật công tắc rồi coi admin đã được bảo vệ. Cần thiết kế lại luồng admin để xử lý thử thách MFA, kiểm tra yếu tố thứ hai ở máy chủ trước khi cấp quyền, đăng ký thiết bị và quy trình khôi phục khi mất thiết bị. Trước triển khai cần test admin/owner thiếu yếu tố hai bị từ chối, TOTP sai/hết hạn, mất thiết bị và tài khoản khách không bị ảnh hưởng. Việc nâng dịch vụ và triển khai MFA thuộc thay đổi riêng sau khi chủ repo duyệt phương án.

| Mã | Yêu cầu | Chỉ tiêu | Hiện trạng |
| --- | --- | --- | --- |
| NF‑14 | Dễ bảo trì | Code chia module, có quy ước và tài liệu | ⚠️ Có README, hướng dẫn đóng góp, CI; riêng `admin.js` còn khoảng 2.400 dòng |
| NF‑15 | Kiểm thử tự động | Mỗi thay đổi đều chạy test | ✅ Khoảng 140 test (unit, emulator, trình duyệt) chạy trên mỗi PR |

## ✅ Tiêu chí nghiệm thu

| Kiểm thử | Hiện trạng |
| --- | --- |
| Khôi phục dữ liệu từ bản sao lưu | ✅ Test tự động trên emulator |
| Tải tăng 10–20 lần | ❌ Chưa có |
| Đo thời gian tải trang và thanh toán | ⚠️ Đã đo Lighthouse; chưa đo thanh toán |
| Nhiều người cùng mua sản phẩm cuối cùng | ⚠️ Có test chống bán vượt kho; chưa test nhiều người cùng lúc |
| Quyền của khách, quản lý, chủ cửa hàng | ✅ Có test tự động |
