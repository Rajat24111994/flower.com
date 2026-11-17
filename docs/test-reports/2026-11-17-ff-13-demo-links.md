# FF-13 — Đồng bộ link demo và tài liệu triển khai

Issue #168. Ngày kiểm tra: 17/11/2026, Asia/Bangkok.

## Kết quả

URL chính thức duy nhất: **`https://flower-com.onrender.com`** (Render, Docker, tự deploy `main` sau khi CI xanh).

| Nơi dùng link | Trạng thái |
| --- | --- |
| Phần About → Website của repo GitHub | Đổi từ link Netlify của repo gốc sang `https://flower-com.onrender.com` (17/11/2026). Đã kiểm tra qua GitHub API: `homepage` = URL Render |
| Biến GitHub Actions `FLOWER_APP_URL` | Đã là `https://flower-com.onrender.com` |
| `README.md` | Đã dùng URL Render; nhắc Vercel chỉ còn chuyển hướng |
| Thẻ canonical, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt`, `js/catalog/product.js` | Đã dùng URL Render |
| `flower.com/docs/backend/DEPLOYMENT.md` | Ghi Render là hosting chính thức, cách rollback và auto-deploy |
| `docs/issue-119-deployment.md` | Cập nhật URL chính thức, kiểm tra trang thật và Lighthouse trên Render |
| `docs/PROVENANCE.md` | Link Netlify được ghi là demo của repo gốc, không còn dùng |
| `flower.com/vercel.json` | Giữ lại: lo chuyển hướng 307 từ `flower-com-six.vercel.app` sang Render |

Các báo cáo cũ có ngày (`docs/issue-review-123.md`, bản audit bảo mật 09/11, `2026-11-17-ff-05-vnpay-real-sandbox.md`) giữ nguyên vì là bằng chứng tại thời điểm đó.

## Kiểm tra trực tiếp

- `https://flower-com.onrender.com/health` trả 200; các trang chính và API đọc trả 200.
- `http://flower-com.onrender.com/` trả 301 sang HTTPS.
- `https://flower-com-six.vercel.app/about.html` trả 307 sang `https://flower-com.onrender.com/about.html`.
- Chi tiết header bảo mật, TLS và Lighthouse: [`docs/issue-119-deployment.md`](../issue-119-deployment.md).

## Giới hạn

- Gói Render Free ngủ sau khoảng 15 phút không có truy cập; lần mở đầu tiên chậm 30–60 giây.
- Chuyển hướng từ Vercel đang là tạm thời (307). Khi ổn định có thể đổi `permanent` thành `true` trong `flower.com/vercel.json`.
