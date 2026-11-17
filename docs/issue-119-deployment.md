# Bằng chứng triển khai — issue #119

Tài liệu ghi lại những gì đã kiểm tra được trên môi trường thật, những gì còn thiếu, và hướng dẫn để chủ repo bổ sung bằng chứng còn lại. Không ghi secret, khóa dịch vụ hay dữ liệu khách hàng vào đây.

## 1. URL chính thức

- **URL chính thức: `https://flower-com.onrender.com`** (Render, gói Free, Docker, region Singapore). Render tự deploy nhánh `main` sau khi CI xanh. Backend là ASP.NET Core C# trong `flower.com/backend/`. README, `sitemap.xml`, `robots.txt`, thẻ canonical và dữ liệu SEO đều dùng URL này.
- Địa chỉ Vercel cũ `https://flower-com-six.vercel.app` chỉ còn chuyển hướng 307 sang Render (`redirects` trong `flower.com/vercel.json`).
- Link Netlify (`genuine-malabi-a05086.netlify.app`) là bản demo của repo gốc năm 2023 (xem [`PROVENANCE.md`](PROVENANCE.md)), không còn liên quan.
- Phần **About → Website** của repo và biến GitHub Actions `FLOWER_APP_URL` đã đổi sang URL Render ngày 17/11/2026 (#168).

## 2. Kiểm tra trang thật ngày 17/11/2026 (03:05 UTC)

Chạy bằng `curl` trên URL Render. Lần kiểm tra trước (11/11/2026, trên Vercel) phát hiện toàn bộ API trả 500; lỗi đó không còn vì website đã chuyển sang backend C# trên Render.

| Hạng mục | Kết quả | Đánh giá |
| --- | --- | :---: |
| `/health` | HTTP 200 | ✅ |
| Trang tĩnh `/`, `/product.html`, `/cart.html`, `/checkout.html`, `/admin.html`, `/login.html`, `/tracking.html` | HTTP 200, 0,21–0,27 giây | ✅ |
| `sitemap.xml`, `robots.txt` | HTTP 200 | ✅ |
| API `/api/products`, `/api/delivery-zones`, `/api/bouquet-wrapping` | HTTP 200, đọc được Firestore | ✅ |
| `POST /api/login` với JSON rỗng | HTTP 400 `invalid-argument` (đúng); sai mật khẩu trả 401 `invalid-credential` | ✅ |
| HTTPS và chứng chỉ | Chứng chỉ do Google Trust Services (WE1) cấp, hết hạn 20/12/2026, Render tự gia hạn | ✅ |
| HTTP → HTTPS | `http://flower-com.onrender.com/` trả 301 sang HTTPS | ✅ |
| Vercel cũ → Render | `flower-com-six.vercel.app/about.html` trả 307 sang `flower-com.onrender.com/about.html` | ✅ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | ✅ |
| `Content-Security-Policy` | Có; `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` | ✅ |
| `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | `DENY`, `nosniff`, `strict-origin-when-cross-origin`, camera/micro/vị trí tắt | ✅ |

Giới hạn: gói Render Free ngủ sau khoảng 15 phút không có truy cập; lần mở đầu tiên sau đó mất khoảng 30–60 giây.

## 3. Firestore Security Rules đã deploy

Repo có `flower.com/firestore.rules`, nhưng có file trong repo chưa chứng minh được Rules đã deploy lên đúng project. Bằng chứng cần lưu (chủ repo tự làm, có quyền trên project `web-ban-hoa-9fe0b`):

```bash
cd flower.com && npx firebase deploy --only firestore:rules,firestore:indexes --project web-ban-hoa-9fe0b
```

Sau đó chụp màn hình **Firebase Console → Firestore → Rules**, thấy được project ID, thời gian "Last published" và nội dung khớp file trong repo. Lưu ảnh vào `docs/test-reports/` kèm ngày.

## 4. Kiểm thử VNPay sandbox (#39)

Cần tài khoản merchant sandbox. Chủ repo tự nhập `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV=sandbox`, `PUBLIC_APP_URL=https://flower-com.onrender.com` vào **Render → service flower.com → Environment** theo [`payments-vnpay.md`](payments-vnpay.md), rồi chạy đủ 5 kịch bản. Thẻ thử lấy từ trang tài liệu sandbox của VNPay.

| # | Kịch bản | Cách làm | Kết quả mong đợi (theo backend C#, `/api/vnpay-ipn`) | Kết quả thật |
| --- | --- | --- | --- | --- |
| 1 | Thanh toán thành công | Đặt đơn VNPay, trả bằng thẻ thử hợp lệ | IPN trả `RspCode 00`; đơn chuyển `paymentStatus = da_thanh_toan`, `paymentVerified = true`; trang kết quả báo thành công | |
| 2 | Khách hủy hoặc thẻ bị từ chối | Bấm hủy trên trang VNPay hoặc dùng thẻ bị từ chối | IPN trả `00`; đơn `paymentStatus = that_bai`, hàng vẫn giữ tới hết 15 phút rồi hoàn kho | |
| 3 | IPN gửi trùng | Gửi lại IPN của giao dịch 1 từ trang quản lý merchant | IPN trả `00` ("Confirm Success"), không ghi nhận thanh toán lần hai | |
| 4 | Sai số tiền | Gửi IPN có `vnp_Amount` khác số tiền đơn (sửa tham số rồi ký lại bằng hash secret sandbox) | IPN trả `04 Invalid amount`; đơn không đổi | |
| 5 | Thanh toán sau khi đơn hết hạn | Tạo đơn, chờ quá 15 phút cho đơn bị hủy rồi mới thanh toán | IPN trả `00`, ghi `latePayment = true` để admin xử lý hoàn tiền; đơn đã hủy không tự mở lại | |

Ngoài ra: chữ ký sai trả `97`, thiếu cấu hình trả `99`, mã giao dịch lạ trả `01`. Các trường hợp này đã có test tự động (`tests/vnpay.test.js`, `flower.com/tests/IntegrationTests/vnpay.test.js`).

Ghi kết quả thật vào cột cuối kèm mã giao dịch sandbox (`vnp_TransactionNo`) và ảnh chụp đơn trong trang admin; che số điện thoại và địa chỉ.

## 5. Hiệu năng (Lighthouse)

Chạy ngày 17/11/2026 (03:10 UTC) bằng Lighthouse 12.8.2, chế độ Mobile, Chrome headless trên máy Windows, URL Render đang chạy (không phải lần khởi động nguội).

| Trang | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 86 | 96 | 100 | 100 | 3,3 s | 3,3 s | 0 ms | 0 |
| `/product.html` | 86 | 96 | 100 | 100 | 1,9 s | 3,9 s | 100 ms | 0 |

Báo cáo đầy đủ: [`2026-11-17-lighthouse-render-home.html`](test-reports/2026-11-17-lighthouse-render-home.html), [`2026-11-17-lighthouse-render-product.html`](test-reports/2026-11-17-lighthouse-render-product.html). NF-05 yêu cầu trang chọn hoa tải trong 5 giây: `/product.html` đạt (LCP 3,9 s trên mô phỏng 4G chậm).

## Tóm tắt trạng thái

| Hạng mục #119 | Trạng thái |
| --- | --- |
| Chọn URL chính thức | ✅ `flower-com.onrender.com`; About và `FLOWER_APP_URL` đã đổi (#168) |
| Bằng chứng HTTPS/HSTS/CSP | ✅ Kiểm tra lại trên Render ngày 17/11/2026 (mục 2) |
| API chạy trên production | ✅ Lỗi 500 trên Vercel không còn; API trên Render trả 200 (mục 2) |
| Firestore Rules đã deploy | ⏳ Chủ repo chạy lệnh và chụp Console (mục 3) |
| VNPay sandbox 5 kịch bản | ⏳ Cần tài khoản sandbox (mục 4, #160) |
| Lighthouse trên URL thật | ✅ Đã chạy ngày 17/11/2026 (mục 5) |
| Mô tả thanh toán chỉ còn COD và VNPay | ✅ README và `checkout.html` chỉ có COD và VNPay; đơn QR cũ chỉ còn để admin đối soát (#122) |
