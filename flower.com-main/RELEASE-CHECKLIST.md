# Checklist phát hành

Làm lần lượt từ trên xuống cho mỗi lần phát hành. Mục nào không đạt thì dừng lại, sửa rồi làm lại từ đầu.

## 1. Trước khi gộp vào `main`

- [ ] Mọi thay đổi đi qua Pull Request, có ít nhất 1 người review (xem `CONTRIBUTING.md`).
- [ ] CI trên PR xanh: **Unit test + coverage** và **Feature, system và security test (Firebase Emulator)**.
- [ ] Coverage không giảm so với lần phát hành trước (xem bảng trong trang kết quả CI).
- [ ] Đổi file JS/CSS thì đã tăng số `?v=` trong các trang `.html` dùng file đó (tránh trình duyệt dùng bản cũ).
- [ ] Đổi `firestore.rules` thì có test trong `tests/integration/security-rules.test.js`.

## 2. Chuẩn bị bản phát hành

- [ ] Viết `RELEASE_NOTES_vX.Y.Z.md`: tính năng mới, lỗi đã sửa, thay đổi cần thao tác tay, hạn chế còn lại.
- [ ] Cập nhật mục "Hạn chế đã biết" trong `README.md` nếu có thay đổi.
- [ ] Chạy trên máy:
  ```sh
  cd flower.com && npm ci && npm test
  cd ../tests && npm ci && npm run integration
  ```

## 3. Triển khai

- [ ] Gộp PR vào `main` (Vercel tự deploy).
- [ ] Có thay đổi `firestore.rules`, index hoặc dữ liệu mẫu thì chạy:
  ```sh
  cd flower.com && npm run setup-firestore
  ```
- [ ] Biến môi trường trên Vercel còn đủ: `FIREBASE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`.

## 4. Smoke test ngay sau khi deploy

- [ ] Chạy smoke test tự động (không tạo đơn, không đổi dữ liệu):
  ```sh
  cd flower.com && SMOKE_URL=https://flower-com-six.vercel.app npm run smoke
  ```
  hoặc trên GitHub: **Actions → Smoke test → Run workflow**.
- [ ] Kiểm tra tay 5 phút trên điện thoại và máy tính:
  - [ ] Trang chủ và danh sách hoa hiện đủ sản phẩm, có ảnh.
  - [ ] Thêm vào giỏ → thanh toán → báo giá đúng, ưu đãi tự áp dụng.
  - [ ] Đăng nhập tài khoản khách → "Đơn hàng của bạn" hiện đơn cũ.
  - [ ] Đăng nhập admin → tab Đơn hàng, Sản phẩm, Đánh giá, Phản hồi tải được.
  - [ ] Console trình duyệt không có lỗi đỏ.

## 5. Sau phát hành

- [ ] Gắn tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- [ ] Theo dõi log Vercel (Functions) trong 24 giờ đầu, đặc biệt cron `/api/orders?action=expire`.
- [ ] Có lỗi nghiêm trọng: trên Vercel chọn bản deploy trước → **Promote to Production** để quay lại, rồi mới sửa.
