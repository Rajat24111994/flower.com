# Kế hoạch nghiên cứu người dùng

Cho issue #131. Tài liệu gồm kế hoạch, kịch bản phỏng vấn, kịch bản usability test và mẫu ghi chép. **Chưa có kết quả**: nhóm điền vào mục 6 và 7 sau khi thực hiện. Không ghi họ tên, số điện thoại hay ảnh nhận diện người tham gia; dùng mã `PV-01`, `UT-01`…

## 1. Mục tiêu

1. Kiểm chứng 4 persona giả định ([`PERSONAS.md`](PERSONAS.md)).
2. Tìm lỗi khiến khách không đặt được hàng trên điện thoại (luồng chính M1 trong [charter](PROJECT-CHARTER.md)).
3. Biết nhân viên và chủ cửa hàng cần gì nhất ở trang quản trị.
4. Mỗi phát hiện quan trọng phải thành một issue, để truy vết được từ phản hồi người dùng tới thay đổi trong backlog.

## 2. Kế hoạch

| Hoạt động | Số người | Ai | Thời lượng | Đầu ra |
| --- | ---: | --- | --- | --- |
| Phỏng vấn khách mua hoa (P1, P2) | ≥ 5 | Bạn bè, người thân đã từng mua hoa online | 15–20 phút | Ghi chú `PV-xx` |
| Phỏng vấn người bán hoa (P3, P4) | ≥ 1–2 | Cửa hàng hoa gần trường, hoặc người bán qua mạng xã hội | 20–30 phút | Ghi chú `PV-xx` |
| Khảo sát nhanh (Google Forms) | ≥ 20 | Lớp, câu lạc bộ | 3 phút | Bảng tổng hợp |
| Usability test luồng mua hàng | ≥ 5 | Người chưa từng dùng FlowerFlow | 20 phút | Ghi chú `UT-xx`, danh sách lỗi |

Trước khi bắt đầu, đọc lời đồng ý (mục 5) và chỉ ghi âm khi người tham gia đồng ý.

## 3. Kịch bản phỏng vấn

**Khách mua hoa (P1, P2)**

1. Lần gần nhất bạn mua hoa là dịp gì? Mua ở đâu, bằng cách nào?
2. Bạn chọn bó hoa dựa vào gì (giá, màu, loài hoa, ý nghĩa, ảnh)?
3. Lúc mua, điều gì làm bạn lo lắng hoặc khó chịu nhất?
4. Bạn muốn trả tiền thế nào? Vì sao?
5. Bạn có từng muốn tự chọn loại hoa, màu giấy gói không? Nếu có thì chọn những gì?
6. Sau khi đặt, bạn muốn được báo những thông tin gì?
7. Điều gì khiến bạn quay lại mua lần nữa ở cùng một nơi?

**Người bán hoa (P3, P4)**

1. Một ngày bình thường và một ngày lễ, cửa hàng nhận bao nhiêu đơn, qua kênh nào?
2. Bạn ghi đơn, tính tiền và theo dõi kho bằng gì?
3. Lỗi nào hay xảy ra nhất (nhầm giá, hết hoa, giao trễ, nhầm địa chỉ)?
4. Giá hoa nguyên liệu thay đổi thế nào? Bạn cập nhật giá bán ra sao?
5. Bạn cần xem những số liệu nào về doanh thu?
6. Nhân viên được phép làm gì, không được làm gì (ví dụ giảm giá)?

## 4. Kịch bản usability test

Dùng điện thoại thật, mở https://flower-com-six.vercel.app. Người điều phối chỉ đọc nhiệm vụ, không hướng dẫn. Người tham gia vừa làm vừa nói ra suy nghĩ.

| # | Nhiệm vụ | Thành công khi | Đo |
| --- | --- | --- | --- |
| T1 | "Tìm một bó hoa hồng tặng sinh nhật dưới 500.000 ₫" | Mở được trang chi tiết một bó phù hợp | Thời gian, số lần quay lại |
| T2 | "Thêm bó đó vào giỏ, kèm lời nhắn trên thiệp" | Giỏ có sản phẩm và lời nhắn | Thời gian, lỗi |
| T3 | "Đặt giao ngày mai buổi sáng tới Cầu Giấy, trả khi nhận hàng" | Đặt xong, thấy mã đơn | Thời gian, lỗi, có hiểu phí giao không |
| T4 | "Kiểm tra đơn vừa đặt đang ở bước nào" | Mở trang theo dõi, thấy trạng thái | Thời gian |
| T5 (admin) | "Xác nhận đơn vừa có và chuyển sang Đang chuẩn bị" | Trạng thái đổi đúng | Số thao tác |

Sau buổi test hỏi: điểm hài lòng từ 1 đến 5; điều khó nhất; một điều muốn thay đổi.

Lưu ý: dùng đơn thử và hủy đơn sau buổi test để hoàn kho. Không thanh toán VNPay thật.

## 5. Lời đồng ý (đọc trước khi bắt đầu)

> "Mình đang làm đồ án môn học về website bán hoa FlowerFlow. Buổi trò chuyện khoảng 20 phút. Mình chỉ ghi lại ý kiến, không ghi tên hay số điện thoại của bạn, và chỉ dùng trong đồ án. Bạn có thể dừng bất cứ lúc nào. Mình có thể ghi âm để ghi chép cho chính xác không?"

## 6. Mẫu ghi chép (mỗi người một file `docs/product/research/PV-xx.md` hoặc `UT-xx.md`)

```markdown
# PV-01 (hoặc UT-01)
- Ngày, hình thức: 
- Persona gần nhất: P1 / P2 / P3 / P4
- Đồng ý ghi âm: có / không

## Ý chính (trích dẫn ngắn)
- 

## Vấn đề phát hiện
| # | Vấn đề | Mức độ (cao/vừa/thấp) | Nhiệm vụ (T1–T5) |
| --- | --- | --- | --- |

## Kết quả nhiệm vụ (usability test)
| Nhiệm vụ | Hoàn thành | Thời gian | Ghi chú |
| --- | --- | --- | --- |

Điểm hài lòng (1–5):
```

## 7. Tổng hợp và truy vết vào backlog

Điền sau khi có dữ liệu. Mỗi vấn đề lặp lại ở ≥ 2 người, hoặc mức độ cao, phải tạo issue.

| Phát hiện | Nguồn | Số người gặp | Issue tạo ra | PR xử lý | Trạng thái |
| --- | --- | ---: | --- | --- | --- |
| Chưa có dữ liệu | | | | | |
