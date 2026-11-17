# Nguồn gốc mã nguồn (provenance)

Tài liệu cho issue #130: phân biệt phần kế thừa từ repository gốc với phần nhóm FlowerFlow phát triển, và nêu các việc còn lại về giấy phép. Số liệu dòng ở mục 2 là snapshot lịch sử 11/11, không phải số đo hiện tại hoặc kết luận quyền. Cập nhật chính sách ngày 17/11/2026 theo #169: người duy trì chọn giữ repo chưa cấp phép công khai; xem [NOTICE](../NOTICE.md).

## 1. Repository gốc

| Thuộc tính | Giá trị |
| --- | --- |
| Repository gốc | [Rajat24111994/flower.com](https://github.com/Rajat24111994/flower.com) (dự án "casual-metal-9545") |
| Thời gian phát triển | 02/2023 – 13/03/2023, 74 commit |
| Tác giả gốc (theo git) | Rajat24111994 (22 commit), vaibhav mahandiratta (16), amanraj0111 (15), vkmr007 (9), Vikram Naik (7), Vikram043 (5) |
| Nội dung | 45 file: trang HTML/CSS/JS tĩnh (trang chủ, sản phẩm, giỏ, đăng nhập, wishlist, đặt hàng, admin) và 21 ảnh; dữ liệu qua MockAPI |
| Giấy phép | **Không thấy LICENSE cấp repo**; GitHub API license=null ngày 17/11/2026. Không tìm thấy văn bản cho phép cấp phép lại trong hồ sơ repo |
| Bản demo gốc | Netlify (`genuine-malabi-a05086.netlify.app`), không còn dùng. Website hiện tại: `https://flower-com.onrender.com` (phần About của repo đã đổi sang link này; xem #119, #168) |

`Longg5048/flower.com` là fork của repo trên. Commit chung cuối cùng là `9bd76dc` (13/03/2023, "Update README.md"). Nhóm FlowerFlow bắt đầu commit từ 05/10/2026.

## 2. Số đo lịch sử trên main ngày 11/11/2026

| Chỉ số | Giá trị |
| --- | --- |
| Commit của nhóm sau điểm fork | 417 |
| Dòng code/tài liệu trên `main` (`.js`, `.html`, `.css`, `.md`, `.json`, `.yml`, `.sql`, `.rules`, trừ `package-lock.json`) | 43.530 |
| Dòng mà `git blame -M -C` quy về commit của repo gốc | **77 (≈ 0,18%)** |
| File giống hệt bản gốc (cùng nội dung, kể cả ảnh) | **0** |

Báo cáo lịch sử phân loại 77 dòng vào 4 file dưới đây. Đây là attribution của git blame, không phải đánh giá khả năng bảo hộ hoặc toàn bộ phần kế thừa:

| File | Số dòng | Nội dung |
| --- | ---: | --- |
| `flower.com/js/admin/admin.js` | 32 | Dấu đóng `}` và dòng trống giữa các hàm |
| `flower.com/css/admin/admin.css` | 26 | CSS reset (`padding: 0; margin: 0; box-sizing: border-box;`), dấu `}`, dòng trống |
| `flower.com/admin.html` | 10 | Phần mở đầu HTML chuẩn (`<!DOCTYPE html>`, `<head>`, thẻ `meta charset/viewport/X-UA-Compatible`) |
| `flower.com/js/account/login.js` | 9 | `event.preventDefault();`, dấu `}`, dòng trống |

Sau điểm fork, lịch sử có nhiều thay đổi về Firebase, đặt hàng, VNPay, quản trị, kiểm thử, CI và chuyển backend sang C#. Lịch sử thay đổi không tự chứng minh toàn bộ phần này độc lập về quyền; chuyển ngôn ngữ hoặc đổi file không loại bỏ khả năng là bản phái sinh. 21 ảnh gốc đã được thay hết bằng ảnh có giấy phép, ghi công trong [`product-image-credits.md`](product-image-credits.md) (PR #104).

### Lưu ý về danh tính commit

Commit `6b5ddd5` ("Add wishlist management", 05/10/2026) nằm **sau** điểm fork nhưng mang tên và email noreply của tài khoản `Rajat24111994`. Có thể một thành viên commit bằng cấu hình git mượn từ repo gốc. Cần thành viên tương ứng xác nhận và ghi vào `docs/TEAM.md` (#127).

## 3. Chính sách hiện tại và phạm vi quyền

Người duy trì đã chọn ngày 17/11/2026: **giữ chưa cấp phép công khai**, hoàn thiện
nguồn gốc/thông báo quyền. Không thêm LICENSE MIT/Apache/GPL cấp repo.
`private: true` và `license: UNLICENSED` trong hai npm package chỉ ghi chính sách
của dự án, không đổi license hay thu hẹp quyền của dependency/ảnh/font bên thứ ba.

**Đính chính hướng dẫn cũ:** không thể kết luận chỉ thay 77 dòng blame, đổi dấu ngoặc,
CSS reset hay head HTML là đã có quyền cấp phép lại toàn bộ repository. Blame,
tỷ lệ dòng và số blob giống nhau không đo bản quyền hoặc giấy phép. Không đổi
lịch sử Git để che nguồn gốc hoặc gán công lao cho nhóm.

Theo [GitHub Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository),
public repository không tự cấp quyền tái sử dụng ngoài quyền theo điều khoản GitHub.
Thông báo tại [NOTICE](../NOTICE.md) không phải giấy phép hoặc bảo đảm quyền thương mại.

Ghi công nền dự án ban đầu: Rajat24111994, vaibhav mahandiratta, amanraj0111,
vkmr007, Vikram Naik và Vikram043 theo tên Git. Không gộp alias hay đoán danh tính.
Đóng góp tiếp theo được truy vết trong Git/[TEAM](TEAM.md)/[AI log](AI-USAGE-LOG.md);
đóng góp có AI không tự chứng minh quyền hoặc thay trách nhiệm kiểm tra của người duy trì.

### Kiểm kê ngày 17/11/2026

Source `5c6be2f`, upstream baseline `9bd76dc`. GitHub API upstream license=null;
so blob toàn bộ hai cây Git thấy **0 blob giống hệt**. Kết quả đó không chứng minh
0 nội dung phái sinh và không thay giấy phép.

- [Inventory JSON](licensing/inventory-2026-11-17.json): 1.385 npm locations từ hai
  lockfiles (không phải số gói duy nhất), 15 NuGet references trực tiếp và 46 asset paths.
- [Third-party notices](licensing/THIRD-PARTY.md): metadata license, bản text cho
  3 gói có 5 vị trí thiếu license metadata, SDK CDN và font.
- [Asset register](licensing/ASSETS.md): 33 ảnh có credits, 13 tài sản chưa có hồ sơ
  quyền riêng đầy đủ; không gắn license giả và không xóa tài sản production.
- [Báo cáo FF-14](test-reports/2026-11-17-ff-14-provenance.md): bằng chứng/phạm vi kiểm tra.

### Trước khi thay đổi chính sách hoặc phân phối ngoài phạm vi đã được phép

1. Người duy trì thu thập văn bản cho phép phù hợp từ chủ thể upstream và người
   đóng góp liên quan, làm rõ phạm vi file/quyền/license; không liên hệ thay họ khi chưa được yêu cầu.
2. Bổ sung hồ sơ cho 13 tài sản chưa rõ hoặc chuẩn bị thay có nguồn rõ trong PR riêng.
3. Kiểm tra đầy đủ dependency transitive/native/container của artifact thực, giữ
   license/NOTICE/attribution và điều kiện từng thành phần; bảng metadata không phải clearance.
4. Sau khi có đủ căn cứ và quyết định riêng mới thêm LICENSE với phạm vi rõ ràng.
   Việc chọn giữ chưa cấp phép ở #169 không nghiệm thu quyền phân phối/thương mại.

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
