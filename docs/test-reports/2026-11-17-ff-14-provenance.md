# FF-14: Giấy phép và nguồn gốc mã (#169)

Ngày 17/11/2026; baseline main `5c6be2f`. Người duy trì xác nhận trong phiên làm
việc: **giữ repo chưa cấp phép công khai, hoàn thiện nguồn gốc và thông báo quyền**.
Không tự chọn MIT hay thay đổi giấy phép của thành phần bên thứ ba.

## Kết quả đối chiếu

- GitHub API upstream `Rajat24111994/flower.com`: `license=null`, main
  `9bd76dcab790297bbf6e8624a2f3cb5174af1016`; root tree không có LICENSE/COPYING.
  Không tìm thấy văn bản cho phép cấp phép lại trong hồ sơ repo hiện tại.
- So toàn bộ blob baseline upstream với main baseline: 0 blob giống hệt.
  Không suy diễn thành không còn mã phái sinh hoặc đã có quyền cấp phép lại.
- Sửa PROVENANCE: giữ số liệu blame 11/11 như snapshot lịch sử, bỏ kết luận
  “thay 77 dòng rồi thêm MIT”, không tuyên bố toàn bộ chức năng đều là mã độc lập.
- Thêm NOTICE cấp repo, cập nhật README, hai manifest/lockfile chỉ ở metadata
  project root `license: UNLICENSED`; giữ `private: true`, không đổi dependency/version.
- Inventory reproducible: 1.385 npm package locations gồm bản lặp/test, 15 direct
  NuGet references (10 cặp package/version), 46 asset paths. Không phải SBOM
  toàn bộ NuGet transitive/native/container hoặc kết luận tương thích giấy phép.
- 5 locations thiếu metadata license thuộc fuzzy 0.1.3, limiter 1.1.5, valid-url
  1.0.9: đã đọc/copy license MIT nguyên văn từ package cùng phiên bản. Inventory
  vẫn ghi UNKNOWN cho metadata thiếu; NuGet cache có license expression cho đủ 15 references.
- 33 ảnh có bảng credits; 13 tài sản khác chưa đủ hồ sơ quyền riêng được ghi rõ,
  không gắn CC0/MIT theo phỏng đoán. Không xóa/thay ảnh production.
- Third-party notices ghi font OFL/Firebase CDN, link nguồn; trang Điều khoản có
  link công khai tới credits và NOTICE. Nhật ký AI ghi đúng công việc và chưa giả
  định có review độc lập hoặc quyền đại diện tác giả upstream.

## Kiểm chứng

Môi trường Windows, Python 3, Node 26.13.0; dùng Git history, lockfiles/csproj,
NuGet cache cùng phiên bản và package license text đã cài. Không đọc key/password,
dữ liệu khách hoặc gọi API nghiệp vụ production.

- Chạy audit hai lần với cache: inventory JSON giống byte-for-byte.
- Chạy audit không có cache: 15 NuGet records UNKNOWN thay vì đoán license;
  phần npm/assets/blob giữ nguyên.
- Đối chiếu SHA-256 nội dung ba license với file trong đúng package cài: khớp
  sau chuẩn hóa CRLF/LF (Git trên Windows có thể đổi kiểu xuống dòng, không đổi license text).
- Hai manifest/lockfile đều UNLICENSED ở root; cấu hình/version dependency không đổi.
- Kiểm tra link tương đối của NOTICE/PROVENANCE/third-party/asset/report và anchor
  credits trong HTML; `git diff --check` và SEO/static checks đạt.
- CI trên commit cuối, commit push và trạng thái issue được dẫn trong #169.

Chạy lại từ gốc repository có lịch sử Git tới baseline upstream:

```powershell
python scripts/audit-provenance.py --output artifacts/provenance.json --nuget-cache "$env:USERPROFILE/.nuget/packages"
node --test flower.com/tests/UnitTests/seo-performance.test.js
```

Nếu không có NuGet cache, bỏ tham số tương ứng: kết quả ghi UNKNOWN và vẫn hoạt
động. Snapshot JSON ghi source SHA để không nhầm kết quả baseline với main tương lai.

## Căn cứ tham khảo và giới hạn

[GitHub về giấy phép repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
và [npm package.json license](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#license)
được đọc khi xây dựng chính sách. Metadata/attribution/AI output không thay cho
văn bản quyền của từng chủ thể. Không gửi thông điệp cho tác giả upstream hoặc
thay đổi Git history, không chứng nhận quyền phân phối/thương mại. Phạm vi nghiệm
thu là ghi rõ trạng thái chưa cấp phép và hồ sơ nguồn; license grant, bổ sung chứng
cứ 13 tài sản và kiểm toán artifact trước tái phân phối vẫn là việc sau theo chính sách.
