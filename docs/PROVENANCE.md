# Nguồn gốc mã nguồn (provenance)

Tài liệu cho issue #130: phân biệt phần kế thừa từ repository gốc với phần nhóm FlowerFlow phát triển, và nêu các việc còn lại về giấy phép. Số liệu đo trên `main` ngày 11/11/2026; cách đo ở cuối trang để chạy lại được.

## 1. Repository gốc

| Thuộc tính | Giá trị |
| --- | --- |
| Repository gốc | [Rajat24111994/flower.com](https://github.com/Rajat24111994/flower.com) (dự án "casual-metal-9545") |
| Thời gian phát triển | 02/2023 – 13/03/2023, 74 commit |
| Tác giả gốc (theo git) | Rajat24111994 (22 commit), vaibhav mahandiratta (16), amanraj0111 (15), vkmr007 (9), Vikram Naik (7), Vikram043 (5) |
| Nội dung | 45 file: trang HTML/CSS/JS tĩnh (trang chủ, sản phẩm, giỏ, đăng nhập, wishlist, đặt hàng, admin) và 21 ảnh; dữ liệu qua MockAPI |
| Giấy phép | **Không có file LICENSE**, nên mặc định tác giả gốc giữ toàn bộ quyền |
| Bản demo gốc | Netlify (`genuine-malabi-a05086.netlify.app`). Repo này vẫn để link đó ở phần About; xem #119 |

`Longg5048/flower.com` là fork của repo trên. Commit chung cuối cùng là `9bd76dc` (13/03/2023, "Update README.md"). Nhóm FlowerFlow bắt đầu commit từ 05/10/2026.

## 2. Phần còn lại từ repo gốc trên `main`

| Chỉ số | Giá trị |
| --- | --- |
| Commit của nhóm sau điểm fork | 417 |
| Dòng code/tài liệu trên `main` (`.js`, `.html`, `.css`, `.md`, `.json`, `.yml`, `.sql`, `.rules`, trừ `package-lock.json`) | 43.530 |
| Dòng mà `git blame -M -C` quy về commit của repo gốc | **77 (≈ 0,18%)** |
| File giống hệt bản gốc (cùng nội dung, kể cả ảnh) | **0** |

77 dòng đó nằm trong 4 file, và đều là **mẫu chung, không có logic riêng**:

| File | Số dòng | Nội dung |
| --- | ---: | --- |
| `flower.com/js/admin/admin.js` | 32 | Dấu đóng `}` và dòng trống giữa các hàm |
| `flower.com/css/admin/admin.css` | 26 | CSS reset (`padding: 0; margin: 0; box-sizing: border-box;`), dấu `}`, dòng trống |
| `flower.com/admin.html` | 10 | Phần mở đầu HTML chuẩn (`<!DOCTYPE html>`, `<head>`, thẻ `meta charset/viewport/X-UA-Compatible`) |
| `flower.com/js/account/login.js` | 9 | `event.preventDefault();`, dấu `}`, dòng trống |

Toàn bộ chức năng hiện tại do nhóm viết mới: backend Vercel Functions, Firestore và Security Rules, Firebase Authentication, đặt hàng có giữ kho, VNPay, quản trị, báo cáo, kiểm thử, CI, tài liệu. 21 ảnh gốc đã được thay hết bằng ảnh có giấy phép, ghi công trong [`product-image-credits.md`](product-image-credits.md) (PR #104).

### Lưu ý về danh tính commit

Commit `6b5ddd5` ("Add wishlist management", 05/10/2026) nằm **sau** điểm fork nhưng mang tên và email noreply của tài khoản `Rajat24111994`. Có thể một thành viên commit bằng cấu hình git mượn từ repo gốc. Cần thành viên tương ứng xác nhận và ghi vào `docs/TEAM.md` (#127).

## 3. Giấy phép: việc cần quyết định

Repo gốc không có giấy phép, nên về nguyên tắc nhóm không có quyền cấp phép lại phần của tác giả gốc. Phần đó hiện chỉ còn 77 dòng mẫu chung. Chủ repo chọn một trong hai hướng:

1. **Thay nốt 77 dòng** (viết lại dấu ngoặc, CSS reset, `<head>` HTML) rồi thêm `LICENSE` cho toàn bộ repo, ví dụ MIT. Đây là hướng gọn nhất, vì các dòng này không có nội dung sáng tạo đáng kể.
2. **Xin phép tác giả gốc** (mở issue trên repo gốc) rồi thêm `LICENSE` kèm ghi công.

Cho tới khi quyết định, README ghi rõ nguồn gốc fork và chưa tuyên bố giấy phép.

**Ghi công tác giả gốc:** cấu trúc trang ban đầu (trang chủ, sản phẩm, giỏ, đăng nhập, wishlist, admin) của dự án được khởi tạo từ repo `Rajat24111994/flower.com` của Rajat24111994, vaibhav mahandiratta, amanraj0111, vkmr007 và Vikram Naik (Vikram043).

## 4. Cách đo lại

```bash
git fetch https://github.com/Rajat24111994/flower.com.git main:refs/upstream/main
```

```bash
git fetch --unshallow origin
```

```bash
git merge-base refs/upstream/main origin/main
```

```bash
git rev-list refs/upstream/main > upstream-commits.txt
```

Với mỗi file văn bản trên `main`, đếm số dòng mà `git blame -M -C --line-porcelain origin/main -- <file>` quy về một commit nằm trong `upstream-commits.txt`. File giống hệt được tìm bằng cách so mã blob trong `git ls-tree -r` của hai nhánh.
