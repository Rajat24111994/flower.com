# Bằng chứng triển khai — issue #119

Tài liệu ghi lại những gì đã kiểm tra được trên môi trường thật, những gì còn thiếu, và hướng dẫn để chủ repo bổ sung bằng chứng còn lại. Không ghi secret, khóa dịch vụ hay dữ liệu khách hàng vào đây.

## 1. URL chính thức

- **URL chính thức: `https://flower-com-six.vercel.app`**. Đây là project Vercel `banhoa/flower-com`, deploy từ nhánh `main` với Root Directory `flower.com/`. README, `sitemap.xml`, `robots.txt` và dữ liệu SEO đều dùng URL này.
- Link Netlify (`genuine-malabi-a05086.netlify.app`) là bản demo của repo gốc năm 2023 (xem [`PROVENANCE.md`](PROVENANCE.md)), không còn liên quan.
- **Chủ repo cần làm:** trên trang repo → bánh răng ⚙️ cạnh **About** → ô **Website** → thay link Netlify bằng `https://flower-com-six.vercel.app` → **Save changes**.

## 2. Kiểm tra trang thật ngày 11/11/2026 (02:40 UTC)

Chạy bằng `curl` từ môi trường kiểm thử, sau khi gộp #132, #117 và #116.

| Hạng mục | Kết quả | Đánh giá |
| --- | --- | :---: |
| Trang tĩnh `/`, `/product.html`, `/cart.html`, `/checkout.html`, `/admin.html`, `/login.html`, `/tracking.html` | HTTP 200, 0,14–0,39 giây | ✅ |
| `sitemap.xml`, `robots.txt` | HTTP 200 | ✅ |
| HTTPS và chứng chỉ | HTTP/2; chứng chỉ `*.vercel.app` do Google Trust Services (WR1) cấp, hết hạn 29/01/2027; xác minh hợp lệ | ✅ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | ✅ |
| `Content-Security-Policy` | Có; `script-src` không còn `'unsafe-inline'` (#120) | ✅ |
| `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | `DENY`, `nosniff`, `strict-origin-when-cross-origin`, camera/micro/vị trí tắt | ✅ |
| HTTP → HTTPS | Chưa kiểm tra được: proxy của môi trường kiểm thử chặn HTTP thường. PR #113 đã tự kiểm tra và ghi nhận chuyển hướng 308 | ⚠️ |
| **API** `/api/products`, `/api/orders`, `/api/login`, `/api/delivery-zones`, `/api/bouquet-wrapping`… | **HTTP 500 `FUNCTION_INVOCATION_FAILED` ở cả 11 hàm** | ❌ |

### ❌ Lỗi chặn: toàn bộ API trả 500

- **Lỗi:** từ lần deploy production đầu tiên sau khi sửa build (PR #132), mọi hàm trong `api/` đều trả `FUNCTION_INVOCATION_FAILED`, kể cả các hàm không bị sửa như `/api/login` và `/api/vnpay-ipn`. Khách không xem được giá từ máy chủ, không đặt hàng và không đăng nhập bằng mật khẩu được.
- **Đã loại trừ:** trên máy, cả 11 hàm đều nạp và chạy được với Node 22, kể cả khi thiếu file `@firebase/util/dist/postinstall.js` mà npm trên Vercel bỏ không tạo. Khi đó API trả 503 đúng cách chứ không sập.
- **Cần để tìm nguyên nhân:** log runtime của Vercel. Chủ repo chạy lệnh dưới, mở thử `/api/login`, rồi gửi dòng lỗi đầu tiên. Hoặc vào Vercel → project → **Logs**, lọc mã 500.

```bash
npx vercel logs flower-com-six.vercel.app
```

- **Kiểm tra thêm trên Vercel → Settings → Environment Variables (Production):** có `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`, `CRON_SECRET`; và **Settings → General → Node.js Version** khớp `engines.node` (`24.x`) trong `flower.com/package.json`.
- Trước khi sửa xong, có thể vào **Deployments**, chọn bản production còn chạy được trước đó và bấm **Instant Rollback**.

## 3. Firestore Security Rules đã deploy

Repo có `flower.com/firestore.rules`, nhưng có file trong repo chưa chứng minh được Rules đã deploy lên đúng project. Bằng chứng cần lưu (chủ repo tự làm, có quyền trên project `web-ban-hoa-9fe0b`):

```bash
cd flower.com && npx firebase deploy --only firestore:rules,firestore:indexes --project web-ban-hoa-9fe0b
```

Sau đó chụp màn hình **Firebase Console → Firestore → Rules**, thấy được project ID, thời gian "Last published" và nội dung khớp file trong repo. Lưu ảnh vào `docs/test-reports/` kèm ngày.

## 4. Kiểm thử VNPay sandbox (#39)

Cần tài khoản merchant sandbox. Cài `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV=sandbox`, `PUBLIC_APP_URL` trên Vercel (Preview hoặc Production) theo [`payments-vnpay.md`](payments-vnpay.md), rồi chạy đủ 5 kịch bản. Thẻ thử lấy từ trang tài liệu sandbox của VNPay.

| # | Kịch bản | Cách làm | Kết quả mong đợi (theo `api/vnpay-ipn.js`) | Kết quả thật |
| --- | --- | --- | --- | --- |
| 1 | Thanh toán thành công | Đặt đơn VNPay, trả bằng thẻ thử hợp lệ | IPN trả `RspCode 00`; đơn chuyển `paymentStatus = da_thanh_toan`, `paymentVerified = true`; trang kết quả báo thành công | |
| 2 | Khách hủy hoặc thẻ bị từ chối | Bấm hủy trên trang VNPay hoặc dùng thẻ bị từ chối | IPN trả `00`; đơn `paymentStatus = that_bai`, hàng vẫn giữ tới hết 15 phút rồi hoàn kho | |
| 3 | IPN gửi trùng | Gửi lại IPN của giao dịch 1 từ trang quản lý merchant | IPN trả `00` ("Confirm Success"), không ghi nhận thanh toán lần hai | |
| 4 | Sai số tiền | Gửi IPN có `vnp_Amount` khác số tiền đơn (sửa tham số rồi ký lại bằng hash secret sandbox) | IPN trả `04 Invalid amount`; đơn không đổi | |
| 5 | Thanh toán sau khi đơn hết hạn | Tạo đơn, chờ quá 15 phút cho đơn bị hủy rồi mới thanh toán | IPN trả `00`, ghi `latePayment = true` để admin xử lý hoàn tiền; đơn đã hủy không tự mở lại | |

Ngoài ra: chữ ký sai trả `97`, thiếu cấu hình trả `99`, mã giao dịch lạ trả `01`. Các trường hợp này đã có test tự động (`tests/vnpay.test.js`, `tests/integration/vnpay.test.js`).

Ghi kết quả thật vào cột cuối kèm mã giao dịch sandbox (`vnp_TransactionNo`) và ảnh chụp đơn trong trang admin; che số điện thoại và địa chỉ.

## 5. Hiệu năng (Lighthouse)

Sau khi API chạy lại, mở Chrome → DevTools → **Lighthouse** → Mobile → **Analyze page load** cho `/` và `/product.html` của URL chính thức. Lưu báo cáo HTML vào `docs/test-reports/` kèm ngày. NF-05 yêu cầu trang chọn hoa tải trong 5 giây.

## Tóm tắt trạng thái

| Hạng mục #119 | Trạng thái |
| --- | --- |
| Chọn URL chính thức | ✅ `flower-com-six.vercel.app`; chủ repo đổi link About |
| Bằng chứng HTTPS/HSTS/CSP | ✅ Đã kiểm tra ngày 11/11/2026 (mục 2) |
| API chạy trên production | ❌ Lỗi 500 toàn bộ, cần log Vercel |
| Firestore Rules đã deploy | ⏳ Chủ repo chạy lệnh và chụp Console (mục 3) |
| VNPay sandbox 5 kịch bản | ⏳ Cần tài khoản sandbox (mục 4) |
| Lighthouse trên URL thật | ⏳ Làm sau khi API chạy lại (mục 5) |
| Mô tả thanh toán chỉ còn COD và VNPay | ✅ Đã sửa README, release notes (#122) |
