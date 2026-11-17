# Thành phần bên thứ ba

Ngày 17/11/2026; source baseline `5c6be2f`. Đây là kiểm kê nguồn/metadata, không
phải chứng nhận đã đáp ứng mọi nghĩa vụ phân phối của mọi artifact.

[Thông báo cấp repo](../../NOTICE.md) không cấp phép lại dependency hay ảnh/font.
Giữ LICENSE/NOTICE/copyright đi kèm các gói khi phân phối theo điều kiện gói đó.

## Dependency npm

Hai lockfile `flower.com/package-lock.json` và `flower.com/tests/package-lock.json`
có **1.385 package locations** (gồm bản lặp và dependency test, không phải 1.385
gói duy nhất hoặc tất cả đều nằm trong runtime C#). Metadata license và vị trí
từng gói được giữ trong [inventory JSON](inventory-2026-11-17.json).

Phần lớn metadata là MIT/Apache-2.0/ISC/BSD; không coi một license của package gốc
là license của toàn bộ graph. `dev`/`optional` chỉ là metadata lockfile, không phải
kết luận thành phần có hay không trong artifact phân phối. Các chuỗi không chuẩn
như `BSD` hoặc `public domain` cần đọc license text, không tự chuẩn hóa sang SPDX.

5 vị trí thiếu license trong lockfile thuộc 3 gói. Đã đọc license text từ bản
cài cùng phiên bản, lưu bản nguyên văn để đối chiếu:

| Gói | Kết quả đọc text | Bằng chứng |
| --- | --- | --- |
| fuzzy 0.1.3 (2 lockfiles) | MIT | [LICENSE-MIT](npm/fuzzy-0.1.3-LICENSE-MIT.txt) |
| limiter 1.1.5 | MIT | [LICENSE.txt](npm/limiter-1.1.5-LICENSE.txt) |
| valid-url 1.0.9 (2 lockfiles) | MIT | [LICENSE](npm/valid-url-1.0.9-LICENSE.txt) |

Inventory vẫn ghi UNKNOWN cho metadata thiếu để không giả vờ lockfile đã có trường
license. Không sửa license metadata của gói bên thứ ba trong lockfile.

## Dependency NuGet trực tiếp

Đã đọc 15 PackageReference từ csproj, tương ứng 10 cặp package/version duy nhất,
và `.nuspec` trong NuGet cache cùng phiên bản:

| Gói | Phiên bản | License expression trong nuspec |
| --- | --- | --- |
| Google.Cloud.Firestore | 4.6.0 | Apache-2.0 |
| FirebaseAdmin | 3.7.0 | Apache-2.0 |
| BouncyCastle.Cryptography | 2.7.0 | MIT |
| Microsoft.Data.Sqlite | 10.0.14 | MIT |
| Microsoft.AspNetCore.OpenApi | 10.0.14 | MIT |
| Swashbuckle.AspNetCore.SwaggerUI | 10.3.1 | MIT |
| Microsoft.NET.Test.Sdk | 17.14.1 | MIT |
| Microsoft.AspNetCore.Mvc.Testing | 10.0.14 | MIT |
| xunit | 2.9.3 | Apache-2.0 |
| xunit.runner.visualstudio | 3.1.5 | Apache-2.0 |

Đây chưa phải SBOM NuGet transitive/native/runtime. Khi phát hành binary/container,
phải kiểm tra toàn bộ gói restore, .NET/runtime/base image, SQLite native và artifact
publish thực tế; giữ notice theo thành phần, không lấy bảng trực tiếp làm clearance.

## Tài nguyên tải từ CDN

| Thành phần | Nguồn/giấy phép đã đọc | Phạm vi |
| --- | --- | --- |
| Firebase Web SDK 11.6.0 | [LICENSE theo tag](https://github.com/firebase/firebase-js-sdk/blob/firebase%4011.6.0/LICENSE) | Apache-2.0 và phần third-party notices trong file; browser tải từ gstatic |
| DM Sans | [OFL nguồn](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt) | SIL OFL 1.1; browser tải qua Google Fonts |
| Playfair Display | [OFL nguồn](https://github.com/google/fonts/blob/main/ofl/playfairdisplay/OFL.txt) | SIL OFL 1.1, Reserved Font Name theo file nguồn |

Repo không tự host font binary hiện tại; nếu chuyển sang self-host, lưu đúng bản
font/license/copyright đi kèm và tuân thủ tên dành riêng. License SDK/font không
cấp quyền với mã upstream của website hoặc ảnh cửa hàng. URL font nguồn `main`
có thể thay đổi; đây là mốc đọc ngày 17/11, không khóa phiên bản font từ Google Fonts.
