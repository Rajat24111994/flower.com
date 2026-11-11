# Content Security Policy — issue #120

## Kiểm kê và thay đổi

Kiểm kê 23 trang HTML ở thư mục `flower.com`: có 4 script thực thi inline; không có thẻ `<style>`, thuộc tính `style` hay event handler inline. Các script được chuyển nguyên nội dung, giữ vị trí thực thi:

| Trang | File script mới |
| --- | --- |
| `cart.html` | `js/order/cart.js` |
| `checkout.html` | `js/order/checkout.js` |
| `placeorder.html` | `js/order/placeorder.js` |
| `product.html` | `js/catalog/catalog-sidebar.js` |

JSON-LD trên trang chủ và sản phẩm là dữ liệu có cấu trúc, giữ nguyên. Bộ tạo CSP vẫn hỗ trợ hash chính xác cho script inline khi thật sự cần, nhưng các trang hiện tại không cần hash script thực thi nào. Test chặn việc vô tình thêm script/style/handler inline trở lại.

`script-src` và `style-src` không có `unsafe-inline` hoặc `unsafe-eval`; `script-src-attr` và `style-src-attr` đều là `none`. Script chỉ cho cùng origin, `www.gstatic.com` (Firebase SDK) và `apis.google.com` (Google Auth); CSS cho cùng origin và Google Fonts. Những thay đổi giao diện qua thuộc tính DOM `style` vẫn do script đã được phép thực hiện, không cấp quyền cho style chèn trong HTML.

## Nguồn ảnh được phép

| Nguồn | Mục đích |
| --- | --- |
| `'self'` | Ảnh sản phẩm và tài nguyên cùng website |
| `data:`, `blob:` | Xem trước ảnh người dùng tải lên, ảnh dữ liệu cục bộ |
| `https://firebasestorage.googleapis.com` | Ảnh tải từ Firebase Storage |
| `https://storage.googleapis.com` | Đường dẫn Google Cloud Storage |
| `https://*.googleusercontent.com` | Avatar tài khoản Google |
| `https://img.vietqr.io` | Mã QR chuyển khoản |

Ảnh từ host HTTPS khác bị CSP chặn, kể cả URL được nhập trong phần quản trị. Chuyển ảnh sang Storage hoặc tài nguyên cùng origin; nếu cần nhà cung cấp mới, bổ sung host cụ thể sau khi đánh giá, không mở lại toàn bộ `https:`.

## Tạo cấu hình và kiểm tra

Chạy `cd flower.com` rồi `npm run update:csp` sau khi sửa nguồn được phép. `lib/content-security.js` dùng chung cho bộ tạo `vercel.json`, máy chủ local và máy chủ E2E. Test xác nhận bộ tạo loại bỏ cấu hình cũ quá rộng, chạy lặp không đổi kết quả và file đã tạo khớp chính sách.

Máy chủ E2E gửi CSP qua HTTP header như production; chỉ bỏ `upgrade-insecure-requests`, thêm endpoint emulator loopback trong `connect-src` và iframe Auth Emulator trong `frame-src` để chạy HTTP local. Cờ chế độ auth dùng script cùng origin, không chèn JavaScript inline. Các ngoại lệ loopback này không được ghi vào `vercel.json`.

Test trình duyệt mở mọi trang trên desktop/mobile, thu sự kiện `securitypolicyviolation`, thử chèn script/style và ảnh host lạ để xác nhận bị chặn, đồng thời kiểm tra ảnh QR/Storage/avatar vẫn tải được. Kiểm tra tải trang dùng Firebase SDK bị chặn mạng để không truy cập dữ liệu production; luồng mua hàng được kiểm tra riêng trên Firebase Emulator. Đây là kiểm tra mã và môi trường local, không phải bằng chứng deployment production đã cập nhật.

## Kết quả kiểm tra ngày 11/11/2026

- Unit: 181/181 đạt (`node --test "tests/*.test.js"`).
- Integration: 91/91 đạt trên Firebase Auth/Firestore Emulator, project `demo-flowerflow`, Java 21.
- E2E: 142/142 đạt trên desktop/mobile với CSP được gửi qua HTTP header, gồm mua hàng và đăng nhập Firebase Emulator. Các test CSP cố ý chèn nội dung trái phép xác nhận trình duyệt chặn; tải trang bình thường không phát sinh vi phạm.
- Sau khi thêm ngoại lệ iframe chỉ dành cho emulator, 16 test máy chủ local/CSP/checkout được kiểm tra lại và đều đạt.
- Bốn script sau khi tách khớp nội dung trước đó khi chuẩn hóa dấu xuống dòng. Kiểm tra cú pháp và `git diff --check` đạt.
- Sau khi tích hợp các thay đổi mới trên `main` ở trang đăng nhập/sản phẩm: 60/60 E2E CSP và thao tác mật khẩu, cùng 10/10 test CSP/sản phẩm/checkout đều đạt.

Tham khảo: [MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src), [MDN style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src), [MDN img-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src).
