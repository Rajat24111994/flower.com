# Báo cáo kiểm thử — 2026-11-04

## Thông tin đợt chạy

- **Ngày/giờ:** 2026-11-04 (múi giờ không được ghi nhận)
- **Commit/nhánh:** `main` (các thay đổi đang chờ commit)
- **Môi trường:** Windows; Node.js 24.16.0
- **Người chạy:** Copilot

## Lệnh và kết quả

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `cd flower.com; npm test` | Đạt | 99 | 0 | 0 | Toàn bộ unit tests sau khi hợp nhất thay đổi remote |
| `cd flower.com; npm run test:e2e -- --grep='custom bouquet'` | Đạt | 2 | 0 | 0 | Desktop Chromium và mobile Chromium |
| `cd flower.com; npm run test:e2e -- --grep='admin confirms catalog restoration\|admin filters product status\|admin deletes all products\|custom bouquet'` | Đạt | 8 | 0 | 0 | Kiểm tra giao diện admin và thiết kế trên desktop/mobile |
| `cd flower.com; npm run test:e2e` | Trượt | 44 | 2 | 0 | Hai bài mua hàng không kết nối được Auth Emulator tại `127.0.0.1:8080`; phần còn lại đạt |
| `cd tests; npm run integration` | Không chạy | 0 | 0 | 0 | Firebase Emulator không khởi động được vì Java không khả dụng (`Could not spawn java -version`) |
| `node --check` trên các JavaScript đã sửa | Đạt | 10 | 0 | 0 | Kiểm tra cú pháp |
| `git diff --check` | Đạt | 1 | 0 | 0 | Không có lỗi whitespace |

## Lỗi và cách tái hiện

- **Test/file lỗi:** Hai lượt của `e2e/store-purchase.spec.js`.
- **Nguyên nhân / thông báo lỗi:** Auth Emulator chưa chạy; `apiRequestContext.patch` trả `ECONNREFUSED 127.0.0.1:8080`.
- **Cách tái hiện:** Chạy `cd flower.com; npm run test:e2e` khi chưa bật Firebase Emulator.

## Ghi chú

Test tích hợp và toàn bộ E2E theo cấu hình Emulator cần cài Java 11+ và chạy bằng `npm run integration` hoặc `npm run test:e2e:emulator`.
