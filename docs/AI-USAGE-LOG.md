# Nhật ký sử dụng AI

Ghi lại phần việc có dùng công cụ AI (Claude Code, GitHub Copilot, Codex): AI làm gì, người trong nhóm sửa gì, kiểm chứng ra sao và ai chịu trách nhiệm. Mục tiêu là truy vết được đóng góp, theo yêu cầu của issue #129.

## Quy tắc từ nay

1. Mỗi PR có dùng AI điền mục **"Sử dụng AI"** trong mẫu PR (`.github/pull_request_template.md`).
2. Sau khi gộp, người tạo PR thêm một dòng vào bảng [Nhật ký theo PR](#nhật-ký-theo-pr).
3. Commit có phần do AI viết ghi trailer `Co-authored-by:` của công cụ (Copilot tự thêm), hoặc ghi rõ trong mô tả PR.
4. Không gửi secret, khóa dịch vụ, mật khẩu hay dữ liệu khách hàng thật cho công cụ AI.
5. Người tạo PR chịu trách nhiệm hiểu và giải thích được mọi dòng code được gộp, kể cả phần AI viết.

## Tổng hợp (tính đến 11/11/2026)

| Công cụ | Cách nhận biết trong repo | Phạm vi |
| --- | --- | --- |
| Claude Code | PR từ nhánh `claude/serene-franklin-yw9v89` và `claude/practical-maxwell-lbl2vx`; mô tả PR có dòng "Generated with Claude Code" | 19 PR đã gộp (danh sách bên dưới) và các commit gỡ xung đột cho #116, #117 |
| GitHub Copilot | Trailer `Co-authored-by: Copilot` trong commit | 40 commit không phải merge trên `main` (02/11–09/11/2026): Dol-tech07 17, DoThai207 15, Nanh 4, Longg5048 2, haib15526-oss 2 |
| Copilot (nhánh riêng) | Nhánh `copilot/payment-info*` (Cuongvan-pixel, 02/11/2026) | Trang thông tin thanh toán; **chưa gộp vào `main`** (PR #73 đóng) |
| Codex | Nhánh `codex/cart-stock-limit` (Anh.NV, 12/10/2026) | Điều hướng trang giỏ hàng; **chưa gộp vào `main`** |

Cách đếm: `git log origin/main --no-merges` lọc theo trailer `Co-authored-by`, và danh sách PR gộp từ nhánh `claude/*`. Có thể có phần dùng AI mà không để lại dấu vết trong repo; thành viên tự bổ sung vào bảng.

## Nhật ký theo PR

Cột **Kiểm chứng** lấy từ mô tả PR và kết quả CI khi gộp. Cột **Người sửa / chịu trách nhiệm** ghi người tạo và gộp PR; thành viên bổ sung phần mình đã tự sửa nếu có.

| Ngày gộp | PR | Công cụ | Việc giao cho AI | Kiểm chứng | Người sửa / chịu trách nhiệm |
| --- | --- | --- | --- | --- | --- |
| 26/10/2026 | #57 | Claude Code | Lệnh `npm run setup-firestore` thiết lập database | Chạy thử lệnh, CI xanh | Longg5048 |
| 26/10/2026 | #58 | Claude Code | `setup-firestore` bỏ qua TTL/index cần gói trả phí | CI xanh | Longg5048 |
| 26/10/2026 | #59 | Claude Code | Sửa lỗi F13–F32 (trừ F27) | Unit test, CI xanh | Longg5048 |
| 28/10/2026 | #68 | Claude Code | Bổ sung kiểm thử unit, feature, system, security, CI, smoke test, quy trình review | Bộ test mới chạy trong CI | Longg5048 |
| 28/10/2026 | #69 | Claude Code | Lưu và hiển thị giá bằng VND (issue #40) | `order-pricing`, CI xanh | Longg5048 |
| 02/11/2026 | #71 | Claude Code | Sửa lỗi F42–F49 (giỏ hàng, thanh toán), sao lưu Firestore miễn phí | Viết test trước cho lỗi giỏ hàng/thanh toán; `backup-crypto`, test tích hợp sao lưu/khôi phục trên emulator | Longg5048 |
| 02/11/2026 | #72 | Claude Code | Sửa 2 test đỏ trên `main` (SEO, Playwright mua hàng) | CI xanh lại | Longg5048 |
| 02/11/2026 | #79 | Claude Code | Sửa issue nhỏ: gói quà, bố cục, phương thức thanh toán, dịp lễ, VAT, test mua hàng trên điện thoại | Unit + e2e mobile, CI xanh | Longg5048 |
| 02/11/2026 | #80 | Claude Code | Xóa thư mục `flower.com-main` thừa, sửa cron để Vercel deploy được | Deploy Vercel chạy lại | Longg5048 |
| 03/11/2026 | #81 | Claude Code | Xóa CSS không dùng và 2 hàm không ai gọi | Tìm kiếm toàn repo trước khi xóa, CI xanh | Longg5048 |
| 03/11/2026 | #82 | Claude Code | Ảnh sơ đồ cho wiki | Xem lại ảnh | Longg5048 |
| 03/11/2026 | #83 | Claude Code | Viết lại 3 trang wiki kèm sơ đồ | Đối chiếu với code | Longg5048 |
| 04/11/2026 | #84 | Claude Code | Sắp xếp lại 105 file theo chức năng (`js/`, `css/`, `docs/`) | 77/77 unit, 54/54 tích hợp (theo mô tả PR) | Longg5048 |
| 04/11/2026 | #85 | Claude Code | Thêm ảnh `anh-dai-dien.webp` | Kiểm tra trang sản phẩm | Longg5048 |
| 04/11/2026 | #86 | Claude Code | Nút "Tải ảnh lên từ máy" cho ảnh sản phẩm | Test tích hợp `product-images`, e2e `admin-products` | Longg5048 |
| 04/11/2026 | #104 | Claude Code | Thay ảnh không rõ bản quyền bằng ảnh có giấy phép, ghi công trong `docs/product-image-credits.md` | Test SEO kiểm tra ảnh, xem lại giấy phép từng ảnh | Longg5048 |
| 04/11/2026 | #105 | Claude Code | Sửa logo chân trang bị thành ô trắng (CSS filter) | 80/80 unit; thử 11 trang ở 2 kích thước màn hình (theo mô tả PR) | Longg5048 |
| 11/11/2026 | #132 | Claude Code | Sửa Vercel không deploy được (lệnh `build`, vượt 12 hàm), gộp 3 API; thiết kế database SQL Server | 176/176 unit, 91/91 tích hợp, Vercel Preview Ready; `schema.sql` chạy trên SQL Server 2022, 10/10 kiểm thử quy tắc | Longg5048 |
| 11/11/2026 | #116, #117 (commit gỡ xung đột) | Claude Code | Merge `main` vào nhánh của Dol-tech07 và haib15526-oss, gỡ xung đột; sửa 2 test e2e cũ theo chính sách mật khẩu #121 | Unit, tích hợp và e2e tài khoản chạy trên máy; CI xanh trước khi gộp | Longg5048 (gộp); Dol-tech07, haib15526-oss (tác giả PR) |
| 11/11/2026 | PR cho #122, #125, #126, #129, #130, #119, #131 | Claude Code | Đồng bộ tài liệu, thêm unit test và Firestore giả, load test, nhật ký này, nguồn gốc code, tài liệu triển khai và nghiên cứu người dùng; bổ sung bằng chứng mới vào ma trận truy vết của #124 (ma trận chính do DoThai207 làm) | Ghi trong từng commit; unit 204/204, CI | Longg5048 |

## Việc thành viên cần bổ sung

- [ ] Mỗi thành viên có commit `Co-authored-by: Copilot` thêm một dòng: PR nào, Copilot gợi ý phần nào, mình sửa lại gì.
- [ ] Cuongvan-pixel, Anh.NV: ghi lại nhánh `copilot/payment-info*` và `codex/cart-stock-limit` dùng AI ở đâu, và lý do chưa gộp.
- [ ] Người chịu trách nhiệm mỗi dòng xác nhận mình giải thích được phần code đó khi bảo vệ.
