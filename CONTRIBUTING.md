# Đóng góp cho FlowerFlow

## Quy trình làm một thay đổi

1. Tạo nhánh từ `main` mới nhất: `git checkout main && git pull && git checkout -b feature/ten-ngan-gon`.
2. Viết test trước, rồi mới viết code (Red → Green → Refactor, bên dưới).
3. Chạy test trên máy:
   ```sh
   cd flower.com && npm test
   cd ../tests && npm run integration   # khi đổi API, firestore.rules hoặc luồng đơn hàng
   ```
4. Push nhánh và mở Pull Request vào `main`, điền đủ mẫu PR.
5. Chờ CI xanh và ít nhất **1 người review đồng ý** rồi mới gộp. Không push thẳng lên `main`.

## Test-driven development: Red → Green → Refactor

Áp dụng cho mọi tính năng mới và mọi lỗi được sửa:

1. **Red** – viết một test mô tả hành vi mong muốn (hoặc tái hiện lỗi). Chạy test và thấy nó **thất bại** đúng vì lý do mong đợi. Test chưa từng đỏ thì chưa chứng minh được gì.
2. **Green** – viết đoạn code ít nhất để test đó qua. Chạy lại toàn bộ test.
3. **Refactor** – dọn code (đặt tên, tách hàm, bỏ lặp) mà không đổi hành vi; test vẫn xanh.

Nên commit test đỏ và code sửa thành hai commit liền nhau (`test: ...` rồi `Sửa lỗi ...`/`Thêm ...`), để người review thấy test đã đỏ trước khi có code.

Ví dụ: muốn chặn đặt hàng khi số điện thoại người nhận sai.

```js
// Red: tests/order-validation.test.js
test("từ chối số điện thoại người nhận quá ngắn", () => {
    assert.equal(validateCheckout(checkout({ recipientPhone: "12" })), null);
});
```
Chạy `npm test` → đỏ. Thêm điều kiện trong `validateCheckout` (`flower.com/api/orders.js`) → xanh. Dọn code → vẫn xanh.

### Đặt test ở đâu

| Thay đổi | Loại test | File |
| --- | --- | --- |
| Hàm tính toán, kiểm tra dữ liệu (giá, ưu đãi, trạng thái, giỏ hàng) | Unit | `tests/*.test.js` |
| API `flower.com/api/*.js` (đặt hàng, đăng nhập, quản lý) | Feature | `tests/integration/feature-*.test.js` |
| `firestore.rules`, kiểm tra quyền trong API | Security | `tests/integration/security-*.test.js` |
| Luồng đi qua nhiều phần (trang → API → Firestore) | System | `tests/integration/system.test.js` |

Muốn hàm trong API test được thì đưa nó vào `module.exports.internals` của file đó.

## Code review

Người mở PR:
- PR nhỏ, một mục đích. Mô tả **vì sao** đổi và **cách đã kiểm tra**.
- Tự đọc lại diff trước khi nhờ review.

Người review kiểm tra:
- [ ] Code làm đúng điều PR mô tả; có test cho hành vi mới hoặc lỗi được sửa.
- [ ] Không lộ dữ liệu cá nhân, không tin dữ liệu từ trình duyệt (giá, tên, quyền) khi máy chủ có thể tự kiểm tra.
- [ ] Đổi `firestore.rules` có test bảo mật đi kèm.
- [ ] Đổi file JS/CSS có tăng `?v=` trong các trang `.html`.
- [ ] Thông báo cho người dùng bằng tiếng Việt, dễ hiểu.

Góp ý cụ thể, kèm lý do. Chỉ "Approve" khi đã chạy hoặc đọc kỹ phần test.

## Quality gates (bắt buộc trước khi gộp)

| Cổng | Kiểm tra bởi |
| --- | --- |
| Unit test + kiểm tra cú pháp đạt | CI – job **Unit test + coverage** |
| Feature, system, security test đạt | CI – job **Feature, system và security test (Firebase Emulator)** |
| Coverage không giảm | Người review xem bảng coverage trong trang CI |
| Ít nhất 1 người review đồng ý | GitHub branch protection |
| Không còn góp ý chưa giải quyết | GitHub branch protection |

### Bật bảo vệ nhánh `main` (chủ repo làm một lần)

GitHub → repo → **Settings → Branches → Add branch ruleset** (hoặc *Add rule*) cho `main`:
- ✅ Require a pull request before merging → *Required approvals: 1*, ✅ Dismiss stale approvals, ✅ Require review from Code Owners
- ✅ Require status checks to pass → chọn **Unit test + coverage** và **Feature, system và security test (Firebase Emulator)**, ✅ Require branches to be up to date
- ✅ Require conversation resolution before merging
- ✅ Block force pushes, ✅ Restrict deletions
