# FF-10 — Kiểm tra backup và khôi phục

Issue #165. Ngày 17/11/2026, Asia/Bangkok; baseline main `200abf1`.

## Lỗi và thay đổi

Node và C# trước đây chỉ xuất document ở collection cấp gốc. Đã duyệt đệ quy
subcollection bằng listDocuments/ListDocumentsAsync, bao gồm cha không tồn tại nhưng
còn document con. Archive v1 dùng collection path đầy đủ; không tự tạo lại cha thiếu
khi restore. Archive phẳng cũ vẫn hợp lệ, Node/C# đọc được mã hóa của nhau.

Bổ sung kiểm tra shape/path của archive trước khi đọc/ghi DB; malformed archive
không được ghi một phần chỉ vì cấu trúc lỗi ở cuối file. Validation không thay thế
mọi giới hạn/ràng buộc của Firestore server.

CLI restore preview chỉ giải mã/kiểm tra/đếm, không cần credential. Lỗi parse/khởi tạo
credential được lọc để không in nội dung JSON bí mật vào log. Restore có ghi
phải có `--dong-y --project <id>` và id phải khớp cấu hình; từ chối project sai trước
khi initialize client. Backup từ chối passphrase ngắn trước khi đọc DB. Workflow
kiểm tra độ dài và dùng pipefail; không thay đổi secret hay chạy backup production.
Log đếm document gộp theo collection gốc để không làm lộ ID cha từ đường dẫn
subcollection; đường dẫn đầy đủ chỉ nằm trong archive được mã hóa.

Map thường có latitude/longitude giữ nguyên các trường bổ sung; chỉ GeoPoint SDK mới được mã hóa như GeoPoint. Có kiểm thử hồi quy Node, C# và emulator.

## Kiểm chứng

- Node unit backup/crypto/validation: **15/15 đạt**, 0 bỏ qua.
- Native C# xUnit: **35/35 đạt** (9 bài mới kiểm tra archive malformed/path trước RPC).
- Node backup integration/CLI: **3/3 đạt**, 14,72 giây ở lượt tập trung.
- C# backup contracts + Firestore Emulator: **exit 0**; Node/C# AES-GCM interchange,
  sai mật khẩu/tamper, native types và batch import cùng subcollection/orphan đều đạt.
- Build Release: **0 warning/error**.
- Hồi quy HTTP/SDK toàn bộ: **124/124 đạt**, 0 lỗi/bỏ qua, 121,76 giây.

Diễn tập có 402 document trong collection dữ liệu, document con và cháu ở nhiều cấp,
child dưới cha đã xóa; import vượt ranh 400 write/batch, giữ document ngoài archive,
restore lặp không nhân bản. Đối chiếu Timestamp mili giây, GeoPoint, bytes,
DocumentReference và array/map. Không khẳng định giữ độ chính xác nano giây của v1.

CLI thật được spawn trên dataset demo: export mã hóa → đổi dữ liệu → preview không
credential → thử thiếu/sai target, sai mật khẩu, file bị sửa → restore target đúng.
Các lượt bị từ chối không ghi dữ liệu; target đúng khôi phục payload và giữ document mới.
File mã hóa fixture chỉ tồn tại trong thư mục temp do test tạo và đã được xóa.

## Trạng thái vận hành production

Repository Actions secrets tại lúc kiểm tra chỉ có tên `CRON_SECRET`, thiếu
`FIREBASE_SERVICE_ACCOUNT_JSON` và `BACKUP_PASSPHRASE`. Không đọc giá trị secret.
[Backup run 43772336400](https://github.com/Longg5048/flower.com/actions/runs/43772336400)
thất bại tại preflight vì hai secret đó; các lượt gần nhất liệt kê cũng failure.

Do đó **chưa có bằng chứng backup production tự động hoạt động**, chưa có artifact
production được tải/restore trong lần kiểm tra này. Cấu hình và bằng chứng chạy
theo lịch ≥24 giờ tiếp tục thuộc [#118](https://github.com/Longg5048/flower.com/issues/118),
đang mở. #165 nghiệm thu phần kiểm tra/sửa mã và diễn tập restore tách biệt;
không đóng #118 hoặc lấy dữ liệu demo thay bằng chứng production.

## Tái chạy và giới hạn

```sh
node --test flower.com/tests/UnitTests/backup-crypto.test.js flower.com/tests/UnitTests/backup-validation.test.js
dotnet test flower.com/tests/UnitTests/FlowerFlow.Api.Tests --configuration Release
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node flower.com/tests/IntegrationTests/test-api.cjs backup.test.js"
```

C# console dùng Firestore Emulator riêng trên 8787, rồi chạy
`dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts -c Release -- --backup --firestore-emulator`.

Local Windows, Node 26.13.0, .NET 10, Java 21; CI Node 24. Export không phải snapshot
toàn DB cùng thời điểm; import chỉ nguyên tử theo batch, không toàn archive. Đối soát
đơn/thanh toán/kho và pause writes khi cần restore nhất quán. Không sao lưu Firebase
Auth, Cloud Storage, Rules, indexes, IAM hay secret. Chưa kiểm chứng dung lượng,
RPO/RTO hoặc giới hạn 15 phút trên dữ liệu production. Xem [runbook](../BACKUP-RESTORE.md).
