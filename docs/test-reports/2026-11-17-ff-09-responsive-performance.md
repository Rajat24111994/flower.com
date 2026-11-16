# FF-09 — Responsive và hiệu năng

Issue #164. Ngày 17/11/2026, Asia/Bangkok; thực hiện sau #163.
Windows local, Chromium headless, không throttle CPU/network. Backend .NET 10,
Firestore Emulator project demo; không kiểm thử tải production.

## Responsive

Nhóm mobile-layout + page-performance: **8/8 đạt**, 29,2 giây. Menu, catalog/detail,
cart, checkout và trang xem lại đơn được kiểm tra ở 320/390/768 px, đổi hướng ngang
844 px. Kiểm tra không tràn ngang, nút chạm tối thiểu 44 px, input font 16 px, focus
và Escape của menu, cập nhật cart và khả năng đi tiếp checkout.

Benchmark catalog bổ sung overflow ở desktop 1280 px và mobile 390 px; lần xác nhận
cuối **2/2 đạt**, 7,8 giây. Ảnh/JSON: `artifacts/ff-09-browser` và
`artifacts/ff-09-performance-final`. UI dùng dữ liệu fixture để đo renderer ổn định;
backend không được coi là đã kiểm chứng bởi bài UI này.

## Catalog readiness

Mỗi project điều hướng 5 lần đến catalog 12 sản phẩm, đợi card render. Ngưỡng local
5.000 ms theo mục tiêu tải trang NF-05. Đây không phải Lighthouse hoặc số đo LCP.

| Lượt | Desktop p50 / p95 (ms) | Mobile p50 / p95 (ms) |
| --- | --- | --- |
| Lượt đầu, chạy cùng responsive | 477 / 4495 | 292 / 581 |
| Xác nhận cuối, 1 worker | 193 / 431 | 290 / 567 |

Giữ cả lượt cold chậm 4.495 ms, không thay bằng số warm đẹp hơn. Sample có TTFB,
DOMContentLoaded và transfer bytes của resource same-origin đã hoàn tất khi đo;
không suy ra tổng byte tải trang/CDN từ số này. Bộ 5 mẫu quá nhỏ để đánh giá tail
latency production; cache/network và việc chạy test khác ảnh hưởng đáng kể.

## API latency: HTTP thật tới C# và SDK Firestore

Mỗi nhóm warm-up 3 request, sau đó 24 mẫu; tổng 96 mẫu đo + 12 warm-up, tất cả 200.
GET products và POST orders action quote, không tạo đơn hoặc giữ kho. Có assertion
orders rỗng và quantity không đổi sau đo.

| Endpoint | Concurrency | p50 ms | p95 ms | Max ms | req/s |
| --- | --- | --- | --- | --- | --- |
| GET /api/products | 1 | 12,76 | 16,01 | 17,79 | 76,48 |
| POST /api/orders quote | 1 | 13,52 | 15,31 | 23,28 | 72,05 |
| GET /api/products | 4 | 14,36 | 20,30 | 21,65 | 254,84 |
| POST /api/orders quote | 4 | 19,30 | 22,47 | 23,03 | 198,11 |

JSON local: `artifacts/ff-09/http-latency.json`; CI ASP.NET lưu artifact
`native-http-latency`. Các số req/s chỉ là baseline nhỏ của máy local, không phải
chứng nhận chịu tải. Không lấy kết quả Node handler cũ để đại diện cho C#.

## Tái chạy và giới hạn

```sh
cd flower.com
npx playwright test tests/E2ETests/mobile-layout.spec.js tests/E2ETests/page-performance.spec.js
```

API benchmark chạy bằng `test-api.cjs api-performance.test.js` bên trong Firebase
emulators:exec như hướng dẫn test hiện có. Node local 26.13.0; CI Node 24.

Chưa đo thiết bị thật, 4G/throttle, Lighthouse production, Render cold start,
Web Vitals người dùng thật, uptime 99,9%, tăng tải 10–20 lần hay latency ngân hàng.
Không kết luận mọi NF-01/NF-02/NF-05/NF-06 đã nghiệm thu production. Không sửa giao
diện để né assertion. VNPay thật tiếp tục ở issue #160 đang mở.
