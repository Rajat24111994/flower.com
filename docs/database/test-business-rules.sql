/* =====================================================================
   Kiểm thử quy tắc nghiệp vụ cho docs/database/schema.sql
   Chạy trên một database TRỐNG vừa tạo từ schema.sql (không chạy trên dữ liệu thật).
   Mỗi kiểm thử in PASS; nếu sai, script dừng với lỗi FAIL.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Dữ liệu mẫu ---------- */
INSERT INTO dbo.Users (FirebaseUid, Email, DisplayName, Role) VALUES
    ('uid-owner', 'owner@example.test', N'Chủ cửa hàng', 'owner'),
    ('uid-admin', 'admin@example.test', N'Quản trị', 'admin'),
    ('uid-khach', 'khach@example.test', N'Khách hàng', 'customer');
INSERT INTO dbo.Categories (Name) VALUES (N'Hoa hồng');
INSERT INTO dbo.DeliveryZones (Province, District, Fee) VALUES (N'Hà Nội', N'Cầu Giấy', 30000);
INSERT INTO dbo.Products (Code, Name, CategoryId, SaleType, Unit, CurrentPrice, Stock)
VALUES ('vn-flower-01', N'Bó Hoa Hồng Đỏ Nồng Nàn', 1, 'ready_made', N'bó', 459000, 0);
GO

/* Giá ban đầu và nhập kho 10 bó */
EXEC dbo.usp_SetProductPrice @ProductId = 1, @NewPrice = 459000, @ChangedBy = 1, @Reason = N'Giá khởi tạo';
INSERT INTO dbo.StockReceipts (CreatedBy, Note) VALUES (2, N'Nhập đầu kỳ');
INSERT INTO dbo.StockReceiptItems (ReceiptId, ProductId, Quantity, UnitCost) VALUES (1, 1, 10, 250000);
UPDATE dbo.Products SET Stock = Stock + 10 WHERE Id = 1;
INSERT INTO dbo.InventoryMovements (ProductId, QuantityChange, StockAfter, MovementType, ReceiptItemId, CreatedBy)
VALUES (1, 10, 10, 'import', 1, 2);
GO

/* ---------- Tạo đơn 2 bó ở giá 459.000 ---------- */
BEGIN TRANSACTION;
INSERT INTO dbo.Orders (OrderCode, PaymentReference, IdempotencyKey, RequestHash, UserId, OrderType,
    CustomerName, Phone, Address, RecipientName, RecipientPhone, CustomerIsRecipient,
    DeliveryZoneId, DeliveryProvince, DeliveryDistrict, DeliveryDate, DeliveryTime,
    Subtotal, ShippingFee, Total, PaymentMethod, PaymentStatus, ReservationExpiresAt)
VALUES ('FF0001', 'FFPAY0001', 'idem-1', 'hash-1', 3, 'ready_made',
    N'Nguyễn Văn A', '0900000000', N'1 Xuân Thủy', N'Nguyễn Văn A', '0900000000', 1,
    1, N'Hà Nội', N'Cầu Giấy', '2026-12-01', N'08:00-10:00',
    918000, 30000, 948000, 'vnpay', 'awaiting', DATEADD(MINUTE, 30, SYSUTCDATETIME()));
INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductPriceId, ProductCode, ProductName, SaleType, Unit, UnitPrice, Quantity)
SELECT 1, p.Id, p.CurrentPriceId, p.Code, p.Name, p.SaleType, p.Unit, p.CurrentPrice, 2 FROM dbo.Products p WHERE p.Id = 1;
EXEC dbo.usp_ReserveStock @OrderId = 1, @ProductId = 1, @Quantity = 2;
COMMIT TRANSACTION;
GO

/* T1: Owner đổi giá -> giá mới hiệu lực ngay, đơn cũ giữ giá cũ */
EXEC dbo.usp_SetProductPrice @ProductId = 1, @NewPrice = 499000, @ChangedBy = 1, @Reason = N'Giá hoa tăng';
IF (SELECT CurrentPrice FROM dbo.Products WHERE Id = 1) <> 499000
    THROW 60001, N'FAIL T1a: giá hiện hành chưa cập nhật', 1;
IF (SELECT UnitPrice FROM dbo.OrderItems WHERE OrderId = 1) <> 459000
    THROW 60002, N'FAIL T1b: đơn cũ bị đổi giá', 1;
IF (SELECT COUNT(*) FROM dbo.ProductPrices WHERE ProductId = 1) <> 2
    THROW 60003, N'FAIL T1c: thiếu lịch sử giá', 1;
PRINT N'PASS T1: giá mới hiệu lực ngay, đơn đã đặt giữ giá cũ, lịch sử có 2 dòng';
GO

/* T2: Lịch sử giá không sửa được */
BEGIN TRY
    UPDATE dbo.ProductPrices SET Price = 1 WHERE Id = 1;
    THROW 60010, N'FAIL T2: sửa được lịch sử giá', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 50001 THROW;
    PRINT N'PASS T2: không sửa được lịch sử giá';
END CATCH;
GO

/* T3: Giá trong đơn đã tạo không sửa được */
BEGIN TRY
    UPDATE dbo.OrderItems SET UnitPrice = 1 WHERE OrderId = 1;
    THROW 60020, N'FAIL T3: sửa được giá trong đơn', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 50003 THROW;
    PRINT N'PASS T3: không sửa được giá trong đơn đã tạo';
END CATCH;
GO

/* T4: Không bán vượt kho (còn 8, đặt 9) */
BEGIN TRY
    EXEC dbo.usp_ReserveStock @OrderId = 1, @ProductId = 1, @Quantity = 9;
    THROW 60030, N'FAIL T4: bán vượt kho', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 50005 THROW;
    IF (SELECT Stock FROM dbo.Products WHERE Id = 1) <> 8 THROW 60031, N'FAIL T4b: tồn kho bị thay đổi', 1;
    PRINT N'PASS T4: không cho đặt quá số tồn';
END CATCH;
GO

/* T5: Tổng tiền đơn phải khớp công thức */
BEGIN TRY
    UPDATE dbo.Orders SET Total = 1 WHERE Id = 1;
    THROW 60040, N'FAIL T5: tổng tiền sai vẫn lưu được', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 547 THROW;
    PRINT N'PASS T5: tổng tiền phải bằng tạm tính - giảm + phí gói + phí ship + thuế';
END CATCH;
GO

/* T6: Không tạo được ưu đãi 100% */
BEGIN TRY
    INSERT INTO dbo.Promotions (Name, DiscountPercent) VALUES (N'Miễn phí', 100);
    THROW 60050, N'FAIL T6: tạo được ưu đãi 100%', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 547 THROW;
    PRINT N'PASS T6: chặn ưu đãi trên 90%';
END CATCH;
GO

/* T7: Thanh toán VNPay, IPN gửi trùng bị chặn */
INSERT INTO dbo.Payments (OrderId, Provider, TxnRef, Amount, Status, ProviderTransactionNo, PaidAt)
VALUES (1, 'vnpay', 'TXN-1', 948000, 'paid', 'VNP-14000001', SYSUTCDATETIME());
BEGIN TRY
    INSERT INTO dbo.Payments (OrderId, Provider, TxnRef, Attempt, Amount, Status, ProviderTransactionNo)
    VALUES (1, 'vnpay', 'TXN-2', 2, 948000, 'paid', 'VNP-14000001');
    THROW 60060, N'FAIL T7: ghi nhận trùng giao dịch', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 2601 THROW;
    PRINT N'PASS T7: một giao dịch VNPay chỉ ghi nhận một lần';
END CATCH;
GO

/* T8: Hoàn một phần được, hoàn vượt số đã trả thì bị chặn */
INSERT INTO dbo.Refunds (PaymentId, Amount, Reference, RefundedBy) VALUES (1, 400000, 'REF-1', 2);
BEGIN TRY
    INSERT INTO dbo.Refunds (PaymentId, Amount, Reference, RefundedBy) VALUES (1, 600000, 'REF-2', 2);
    THROW 60070, N'FAIL T8: hoàn vượt số đã thanh toán', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 50006 THROW;
    PRINT N'PASS T8: hoàn một phần được, không hoàn vượt số đã nhận';
END CATCH;
GO

/* T9: Hoàn kho khi hủy đơn, gọi lại lần 2 không cộng kho thêm */
EXEC dbo.usp_ReleaseOrderStock @OrderId = 1, @NewStatus = 'cancelled';
EXEC dbo.usp_ReleaseOrderStock @OrderId = 1, @NewStatus = 'cancelled';
IF (SELECT Stock FROM dbo.Products WHERE Id = 1) <> 10
    THROW 60080, N'FAIL T9: hoàn kho sai', 1;
IF (SELECT COUNT(*) FROM dbo.InventoryMovements WHERE OrderId = 1 AND MovementType = 'release') <> 1
    THROW 60081, N'FAIL T9b: hoàn kho 2 lần', 1;
PRINT N'PASS T9: hủy đơn hoàn đúng 2 bó, gọi lại không hoàn thêm';
GO

/* T10: Đánh giá chỉ nhận 1–5 sao */
BEGIN TRY
    INSERT INTO dbo.Reviews (AuthorUserId, OrderId, CustomerName, Rating, Comment) VALUES (3, 1, N'Khách', 6, N'Tuyệt');
    THROW 60090, N'FAIL T10: nhận 6 sao', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 547 THROW;
    PRINT N'PASS T10: điểm đánh giá chỉ từ 1 đến 5';
END CATCH;
GO

PRINT N'TẤT CẢ KIỂM THỬ ĐÃ QUA';
GO
