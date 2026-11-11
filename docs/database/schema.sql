/* =====================================================================
   FlowerFlow – Thiết kế cơ sở dữ liệu SQL Server (bản đề xuất)
   ---------------------------------------------------------------------
   - Dùng cho phương án A: dữ liệu nghiệp vụ ở SQL Server,
     đăng nhập vẫn do Firebase Authentication quản lý (Users.FirebaseUid).
   - Tiền tệ: VND, kiểu DECIMAL(18,0) – không dùng FLOAT.
   - Thời gian: DATETIME2(3), lưu theo UTC (SYSUTCDATETIME()).
   - Chạy được trên SQL Server 2019+ / Azure SQL.
   - Tài liệu giải thích: docs/database/DATABASE-DESIGN.md
   ===================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- bắt buộc cho filtered index và cột tính toán PERSISTED
GO

/* =====================================================================
   1. NGƯỜI DÙNG VÀ PHÂN QUYỀN
   ===================================================================== */

CREATE TABLE dbo.Users (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    FirebaseUid     NVARCHAR(128)      NOT NULL CONSTRAINT UQ_Users_FirebaseUid UNIQUE,
    Email           NVARCHAR(256)      NULL,
    DisplayName     NVARCHAR(120)      NULL,
    Phone           VARCHAR(20)        NULL,
    Role            VARCHAR(20)        NOT NULL CONSTRAINT DF_Users_Role DEFAULT ('customer'),
    IsActive        BIT                NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Users_Role CHECK (Role IN ('customer', 'admin', 'owner'))
);
CREATE INDEX IX_Users_Email ON dbo.Users (Email) WHERE Email IS NOT NULL;
GO

/* Nhật ký thao tác quản trị (thay cho collection adminAudit / orderPaymentAudit). */
CREATE TABLE dbo.AuditLogs (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
    ActorUserId     INT                NULL CONSTRAINT FK_AuditLogs_Users REFERENCES dbo.Users (Id),
    Action          VARCHAR(60)        NOT NULL,   -- vd: product.price.update, order.payment.verify
    EntityType      VARCHAR(40)        NOT NULL,   -- vd: Product, Order, Promotion
    EntityId        NVARCHAR(64)       NOT NULL,
    OldValue        NVARCHAR(MAX)      NULL,
    NewValue        NVARCHAR(MAX)      NULL,
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_AuditLogs_OldJson CHECK (OldValue IS NULL OR ISJSON(OldValue) = 1),
    CONSTRAINT CK_AuditLogs_NewJson CHECK (NewValue IS NULL OR ISJSON(NewValue) = 1)
);
CREATE INDEX IX_AuditLogs_Entity ON dbo.AuditLogs (EntityType, EntityId, CreatedAt DESC);
GO

/* =====================================================================
   2. SẢN PHẨM VÀ DANH MỤC HOA
   ===================================================================== */

CREATE TABLE dbo.Categories (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_Categories PRIMARY KEY,
    Name            NVARCHAR(80)       NOT NULL CONSTRAINT UQ_Categories_Name UNIQUE,
    GroupKey        VARCHAR(30)        NOT NULL CONSTRAINT DF_Categories_GroupKey DEFAULT ('flowers'),  -- flowers | occasion
    SortOrder       INT                NOT NULL CONSTRAINT DF_Categories_SortOrder DEFAULT (0),
    IsActive        BIT                NOT NULL CONSTRAINT DF_Categories_IsActive DEFAULT (1)
);
GO

CREATE TABLE dbo.Products (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Code            VARCHAR(64)        NOT NULL CONSTRAINT UQ_Products_Code UNIQUE,  -- id cũ trên Firestore, vd vn-flower-01
    Name            NVARCHAR(120)      NOT NULL,
    Description     NVARCHAR(2000)     NULL,
    Meaning         NVARCHAR(500)      NULL,
    CategoryId      INT                NULL CONSTRAINT FK_Products_Categories REFERENCES dbo.Categories (Id),
    SaleType        VARCHAR(20)        NOT NULL,   -- ready_made: bó làm sẵn | flower: hoa nguyên liệu theo cành
    Unit            NVARCHAR(10)       NOT NULL,   -- bó | cành
    /* Giá hiện hành: được ghi CÙNG transaction với dòng mới trong ProductPrices. */
    CurrentPrice    DECIMAL(18,0)      NOT NULL,
    CurrentPriceId  BIGINT             NULL,       -- FK thêm sau khi tạo ProductPrices
    Stock           INT                NOT NULL CONSTRAINT DF_Products_Stock DEFAULT (0),
    SameDayDelivery BIT                NOT NULL CONSTRAINT DF_Products_SameDay DEFAULT (0),
    Status          VARCHAR(20)        NOT NULL CONSTRAINT DF_Products_Status DEFAULT ('active'),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    RowVer          ROWVERSION         NOT NULL,   -- chống ghi đè khi 2 admin sửa cùng lúc
    CONSTRAINT CK_Products_SaleType CHECK (SaleType IN ('ready_made', 'flower')),
    CONSTRAINT CK_Products_Unit     CHECK ((SaleType = 'ready_made' AND Unit = N'bó') OR (SaleType = 'flower' AND Unit = N'cành')),
    CONSTRAINT CK_Products_Price    CHECK (CurrentPrice > 0),
    CONSTRAINT CK_Products_Stock    CHECK (Stock >= 0),                       -- không bao giờ bán vượt kho
    CONSTRAINT CK_Products_Status   CHECK (Status IN ('active', 'hidden', 'archived'))
);
CREATE INDEX IX_Products_Category ON dbo.Products (CategoryId, Status);
CREATE INDEX IX_Products_SaleType ON dbo.Products (SaleType, Status);
GO

/* Màu sắc và dịp tặng (trước đây là mảng colors[] / occasions[]). */
CREATE TABLE dbo.ProductTags (
    ProductId       INT                NOT NULL CONSTRAINT FK_ProductTags_Products REFERENCES dbo.Products (Id) ON DELETE CASCADE,
    TagType         VARCHAR(20)        NOT NULL,   -- color | occasion
    Value           NVARCHAR(50)       NOT NULL,
    CONSTRAINT PK_ProductTags PRIMARY KEY (ProductId, TagType, Value),
    CONSTRAINT CK_ProductTags_Type CHECK (TagType IN ('color', 'occasion'))
);
GO

/* Ảnh sản phẩm: hoặc đường dẫn tĩnh, hoặc ảnh admin tải lên (đã nén). */
CREATE TABLE dbo.ProductImages (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductImages PRIMARY KEY,
    ProductId       INT                NOT NULL CONSTRAINT FK_ProductImages_Products REFERENCES dbo.Products (Id) ON DELETE CASCADE,
    Url             NVARCHAR(1000)     NULL,
    Data            VARBINARY(MAX)     NULL,
    ContentType     VARCHAR(40)        NULL,
    SortOrder       INT                NOT NULL CONSTRAINT DF_ProductImages_Sort DEFAULT (0),   -- 0 = ảnh chính
    UploadedBy      INT                NULL CONSTRAINT FK_ProductImages_Users REFERENCES dbo.Users (Id),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_ProductImages_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_ProductImages_Source CHECK ((Url IS NOT NULL AND Data IS NULL) OR (Url IS NULL AND Data IS NOT NULL AND ContentType IS NOT NULL))
);
CREATE INDEX IX_ProductImages_Product ON dbo.ProductImages (ProductId, SortOrder);
GO

/* =====================================================================
   3. GIÁ BÁN VÀ LỊCH SỬ GIÁ
   Nguyên tắc: chỉ THÊM dòng mới, không sửa/xóa dòng cũ.
   Giá mới có hiệu lực ngay khi transaction lưu giá thành công.
   ===================================================================== */

CREATE TABLE dbo.ProductPrices (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductPrices PRIMARY KEY,
    ProductId       INT                NOT NULL CONSTRAINT FK_ProductPrices_Products REFERENCES dbo.Products (Id),
    Price           DECIMAL(18,0)      NOT NULL,
    PreviousPrice   DECIMAL(18,0)      NULL,
    EffectiveFrom   DATETIME2(3)       NOT NULL CONSTRAINT DF_ProductPrices_Effective DEFAULT (SYSUTCDATETIME()),
    ChangedBy       INT                NULL CONSTRAINT FK_ProductPrices_Users REFERENCES dbo.Users (Id),
    Reason          NVARCHAR(300)      NULL,
    CONSTRAINT CK_ProductPrices_Price CHECK (Price > 0)
);
CREATE INDEX IX_ProductPrices_Product ON dbo.ProductPrices (ProductId, EffectiveFrom DESC);
GO

ALTER TABLE dbo.Products
    ADD CONSTRAINT FK_Products_CurrentPrice FOREIGN KEY (CurrentPriceId) REFERENCES dbo.ProductPrices (Id);
GO

/* Lịch sử giá là bất biến. */
CREATE TRIGGER dbo.TR_ProductPrices_AppendOnly ON dbo.ProductPrices
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50001, N'Lịch sử giá chỉ được thêm mới, không được sửa hoặc xóa.', 1;
END;
GO

/* Cách duy nhất để đổi giá: ghi lịch sử và giá hiện hành trong cùng transaction. */
CREATE PROCEDURE dbo.usp_SetProductPrice
    @ProductId  INT,
    @NewPrice   DECIMAL(18,0),
    @ChangedBy  INT,
    @Reason     NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    DECLARE @OldPrice DECIMAL(18,0);
    SELECT @OldPrice = CurrentPrice
    FROM dbo.Products WITH (UPDLOCK, ROWLOCK)
    WHERE Id = @ProductId;

    IF @OldPrice IS NULL
        THROW 50002, N'Không tìm thấy sản phẩm.', 1;

    INSERT INTO dbo.ProductPrices (ProductId, Price, PreviousPrice, ChangedBy, Reason)
    VALUES (@ProductId, @NewPrice, @OldPrice, @ChangedBy, @Reason);

    DECLARE @PriceId BIGINT = SCOPE_IDENTITY();

    UPDATE dbo.Products
    SET CurrentPrice = @NewPrice, CurrentPriceId = @PriceId, UpdatedAt = SYSUTCDATETIME()
    WHERE Id = @ProductId;

    INSERT INTO dbo.AuditLogs (ActorUserId, Action, EntityType, EntityId, OldValue, NewValue)
    VALUES (@ChangedBy, 'product.price.update', 'Product', CAST(@ProductId AS NVARCHAR(64)),
            CONCAT('{"price":', @OldPrice, '}'), CONCAT('{"price":', @NewPrice, '}'));

    COMMIT TRANSACTION;
END;
GO

/* =====================================================================
   4. KHO HÀNG VÀ NHẬP HÀNG
   Products.Stock là số tồn hiện tại; mọi thay đổi đều có một dòng
   InventoryMovements để truy vết.
   ===================================================================== */

CREATE TABLE dbo.Suppliers (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_Suppliers PRIMARY KEY,
    Name            NVARCHAR(150)      NOT NULL,
    Phone           VARCHAR(20)        NULL,
    Address         NVARCHAR(300)      NULL,
    IsActive        BIT                NOT NULL CONSTRAINT DF_Suppliers_IsActive DEFAULT (1)
);
GO

CREATE TABLE dbo.StockReceipts (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_StockReceipts PRIMARY KEY,
    SupplierId      INT                NULL CONSTRAINT FK_StockReceipts_Suppliers REFERENCES dbo.Suppliers (Id),
    ReceivedAt      DATETIME2(3)       NOT NULL CONSTRAINT DF_StockReceipts_ReceivedAt DEFAULT (SYSUTCDATETIME()),
    CreatedBy       INT                NOT NULL CONSTRAINT FK_StockReceipts_Users REFERENCES dbo.Users (Id),
    Note            NVARCHAR(500)      NULL
);
GO

CREATE TABLE dbo.StockReceiptItems (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_StockReceiptItems PRIMARY KEY,
    ReceiptId       INT                NOT NULL CONSTRAINT FK_StockReceiptItems_Receipts REFERENCES dbo.StockReceipts (Id) ON DELETE CASCADE,
    ProductId       INT                NOT NULL CONSTRAINT FK_StockReceiptItems_Products REFERENCES dbo.Products (Id),
    Quantity        INT                NOT NULL,
    UnitCost        DECIMAL(18,0)      NOT NULL,
    CONSTRAINT CK_StockReceiptItems_Qty  CHECK (Quantity > 0),
    CONSTRAINT CK_StockReceiptItems_Cost CHECK (UnitCost >= 0)
);
GO

/* =====================================================================
   5. ƯU ĐÃI VÀ KHUYẾN MÃI
   ===================================================================== */

CREATE TABLE dbo.Promotions (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_Promotions PRIMARY KEY,
    Name            NVARCHAR(120)      NOT NULL,
    DiscountPercent DECIMAL(5,2)       NOT NULL,
    StartDate       DATE               NULL,
    EndDate         DATE               NULL,
    AppliesToAll    BIT                NOT NULL CONSTRAINT DF_Promotions_All DEFAULT (0),
    IsActive        BIT                NOT NULL CONSTRAINT DF_Promotions_Active DEFAULT (1),
    CreatedBy       INT                NULL CONSTRAINT FK_Promotions_Users REFERENCES dbo.Users (Id),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Promotions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    /* Chặn ưu đãi 100% (hạn chế đang ghi trong wiki NFR). */
    CONSTRAINT CK_Promotions_Percent CHECK (DiscountPercent > 0 AND DiscountPercent <= 90),
    CONSTRAINT CK_Promotions_Dates   CHECK (StartDate IS NULL OR EndDate IS NULL OR StartDate <= EndDate)
);
GO

CREATE TABLE dbo.PromotionProducts (
    PromotionId     INT                NOT NULL CONSTRAINT FK_PromotionProducts_Promotions REFERENCES dbo.Promotions (Id) ON DELETE CASCADE,
    ProductId       INT                NOT NULL CONSTRAINT FK_PromotionProducts_Products REFERENCES dbo.Products (Id),
    CONSTRAINT PK_PromotionProducts PRIMARY KEY (PromotionId, ProductId)
);
GO

/* =====================================================================
   6. KHU VỰC GIAO HÀNG VÀ PHÍ GÓI BÓ
   ===================================================================== */

CREATE TABLE dbo.DeliveryZones (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_DeliveryZones PRIMARY KEY,
    Province        NVARCHAR(120)      NOT NULL,
    District        NVARCHAR(120)      NOT NULL,
    Fee             DECIMAL(18,0)      NOT NULL,
    IsEnabled       BIT                NOT NULL CONSTRAINT DF_DeliveryZones_Enabled DEFAULT (1),
    UpdatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_DeliveryZones_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_DeliveryZones_Area UNIQUE (Province, District),
    CONSTRAINT CK_DeliveryZones_Fee  CHECK (Fee >= 0)
);
GO

/* Phí gói bó hoa tự chọn theo bậc số cành (tối đa 50 cành, tối đa 10 bậc). */
CREATE TABLE dbo.WrappingFeeTiers (
    Id              INT IDENTITY(1,1)  NOT NULL CONSTRAINT PK_WrappingFeeTiers PRIMARY KEY,
    MaxStems        INT                NOT NULL CONSTRAINT UQ_WrappingFeeTiers_Max UNIQUE,
    Fee             DECIMAL(18,0)      NOT NULL,
    CONSTRAINT CK_WrappingFeeTiers_Max CHECK (MaxStems BETWEEN 1 AND 50),
    CONSTRAINT CK_WrappingFeeTiers_Fee CHECK (Fee >= 0)
);
GO

/* =====================================================================
   7. ĐƠN HÀNG VÀ CHI TIẾT ĐƠN HÀNG
   Nguyên tắc: đơn lưu BẢN CHỤP giá, tên, ưu đãi và phí tại lúc đặt.
   Đổi giá sản phẩm sau đó không làm thay đổi đơn đã tạo.
   ===================================================================== */

CREATE TABLE dbo.Orders (
    Id                    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    OrderCode             VARCHAR(32)        NOT NULL CONSTRAINT UQ_Orders_Code UNIQUE,      -- mã khách dùng để tra cứu
    PaymentReference      VARCHAR(40)        NOT NULL CONSTRAINT UQ_Orders_PaymentRef UNIQUE, -- nội dung chuyển khoản
    IdempotencyKey        VARCHAR(80)        NOT NULL CONSTRAINT UQ_Orders_Idempotency UNIQUE,-- chống bấm đặt 2 lần
    RequestHash           VARCHAR(64)        NOT NULL,
    UserId                INT                NULL CONSTRAINT FK_Orders_Users REFERENCES dbo.Users (Id),  -- NULL = khách vãng lai
    OrderType             VARCHAR(20)        NOT NULL,
    -- Người đặt / người nhận
    CustomerName          NVARCHAR(120)      NOT NULL,
    Phone                 VARCHAR(20)        NOT NULL,
    Address               NVARCHAR(300)      NOT NULL,
    RecipientName         NVARCHAR(120)      NOT NULL,
    RecipientPhone        VARCHAR(20)        NOT NULL,
    CustomerIsRecipient   BIT                NOT NULL,
    -- Giao hàng (chụp lại tỉnh/quận để đơn cũ không đổi khi sửa khu vực)
    DeliveryZoneId        INT                NOT NULL CONSTRAINT FK_Orders_DeliveryZones REFERENCES dbo.DeliveryZones (Id),
    DeliveryProvince      NVARCHAR(120)      NOT NULL,
    DeliveryDistrict      NVARCHAR(120)      NOT NULL,
    DeliveryDate          DATE               NOT NULL,
    DeliveryTime          NVARCHAR(40)       NOT NULL,
    GreetingCard          NVARCHAR(300)      NULL,
    AnonymousGreetingCard BIT                NOT NULL CONSTRAINT DF_Orders_Anonymous DEFAULT (0),
    GiftWrap              BIT                NOT NULL CONSTRAINT DF_Orders_GiftWrap DEFAULT (0),
    OrderNote             NVARCHAR(500)      NULL,
    -- Ưu đãi (bản chụp)
    PromotionId           INT                NULL CONSTRAINT FK_Orders_Promotions REFERENCES dbo.Promotions (Id),
    PromotionName         NVARCHAR(120)      NULL,
    DiscountPercent       DECIMAL(5,2)       NULL,
    -- Tiền (bản chụp tại lúc đặt)
    Subtotal              DECIMAL(18,0)      NOT NULL,
    Savings               DECIMAL(18,0)      NOT NULL CONSTRAINT DF_Orders_Savings DEFAULT (0),
    WrappingFee           DECIMAL(18,0)      NOT NULL CONSTRAINT DF_Orders_Wrapping DEFAULT (0),
    ShippingFee           DECIMAL(18,0)      NOT NULL CONSTRAINT DF_Orders_Shipping DEFAULT (0),
    Tax                   DECIMAL(18,0)      NOT NULL CONSTRAINT DF_Orders_Tax DEFAULT (0),   -- giá đã gồm VAT
    Total                 DECIMAL(18,0)      NOT NULL,
    -- Trạng thái
    Status                VARCHAR(20)        NOT NULL CONSTRAINT DF_Orders_Status DEFAULT ('pending'),
    CurrentLocation       NVARCHAR(200)      NULL,
    EstimatedDelivery     NVARCHAR(100)      NULL,
    PaymentMethod         VARCHAR(10)        NOT NULL,
    PaymentStatus         VARCHAR(20)        NOT NULL,
    InventoryState        VARCHAR(20)        NOT NULL CONSTRAINT DF_Orders_Inventory DEFAULT ('reserved'),
    ReservationExpiresAt  DATETIME2(3)       NULL,   -- QR/VNPay 30 phút, COD 24 giờ
    CreatedAt             DATETIME2(3)       NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt             DATETIME2(3)       NOT NULL CONSTRAINT DF_Orders_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CancelledAt           DATETIME2(3)       NULL,
    RowVer                ROWVERSION         NOT NULL,
    CONSTRAINT CK_Orders_Type          CHECK (OrderType IN ('ready_made', 'custom_bouquet')),
    CONSTRAINT CK_Orders_Status        CHECK (Status IN ('pending', 'preparing', 'shipping', 'delivered', 'cancelled', 'expired')),
    CONSTRAINT CK_Orders_PayMethod     CHECK (PaymentMethod IN ('cod', 'qr', 'vnpay')),
    CONSTRAINT CK_Orders_PayStatus     CHECK (PaymentStatus IN ('cod_pending', 'awaiting', 'paid', 'failed', 'refunded', 'partially_refunded')),
    CONSTRAINT CK_Orders_Inventory     CHECK (InventoryState IN ('reserved', 'committed', 'released')),
    CONSTRAINT CK_Orders_Money         CHECK (Subtotal >= 0 AND Savings >= 0 AND Savings <= Subtotal
                                              AND WrappingFee >= 0 AND ShippingFee >= 0 AND Tax >= 0),
    CONSTRAINT CK_Orders_Total         CHECK (Total = Subtotal - Savings + WrappingFee + ShippingFee + Tax)
);
CREATE INDEX IX_Orders_User        ON dbo.Orders (UserId, CreatedAt DESC) WHERE UserId IS NOT NULL;
CREATE INDEX IX_Orders_Status      ON dbo.Orders (Status, CreatedAt DESC);
CREATE INDEX IX_Orders_Reservation ON dbo.Orders (ReservationExpiresAt) WHERE InventoryState = 'reserved';
CREATE INDEX IX_Orders_Phone       ON dbo.Orders (Phone);
GO

/* Một bó hoa tự chọn trong đơn (gồm nhiều dòng hoa theo cành). */
CREATE TABLE dbo.OrderCustomBouquets (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderCustomBouquets PRIMARY KEY,
    OrderId         BIGINT             NOT NULL CONSTRAINT FK_OrderCustomBouquets_Orders REFERENCES dbo.Orders (Id) ON DELETE CASCADE,
    BouquetKey      VARCHAR(64)        NOT NULL,
    StemCount       INT                NOT NULL,
    WrappingFee     DECIMAL(18,0)      NOT NULL,
    CONSTRAINT UQ_OrderCustomBouquets UNIQUE (OrderId, BouquetKey),
    CONSTRAINT CK_OrderCustomBouquets_Stems CHECK (StemCount BETWEEN 1 AND 50),
    CONSTRAINT CK_OrderCustomBouquets_Fee   CHECK (WrappingFee >= 0)
);
GO

CREATE TABLE dbo.OrderItems (
    Id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderItems PRIMARY KEY,
    OrderId             BIGINT             NOT NULL CONSTRAINT FK_OrderItems_Orders REFERENCES dbo.Orders (Id) ON DELETE CASCADE,
    ProductId           INT                NOT NULL CONSTRAINT FK_OrderItems_Products REFERENCES dbo.Products (Id),
    ProductPriceId      BIGINT             NULL CONSTRAINT FK_OrderItems_ProductPrices REFERENCES dbo.ProductPrices (Id), -- phiên bản giá đã dùng
    CustomBouquetId     BIGINT             NULL CONSTRAINT FK_OrderItems_CustomBouquets REFERENCES dbo.OrderCustomBouquets (Id),
    -- Bản chụp tại lúc đặt
    ProductCode         VARCHAR(64)        NOT NULL,
    ProductName         NVARCHAR(120)      NOT NULL,
    ImageUrl            NVARCHAR(1000)     NULL,
    SaleType            VARCHAR(20)        NOT NULL,
    Unit                NVARCHAR(10)       NOT NULL,
    UnitPrice           DECIMAL(18,0)      NOT NULL,
    Quantity            INT                NOT NULL,
    DiscountAmount      DECIMAL(18,0)      NOT NULL CONSTRAINT DF_OrderItems_Discount DEFAULT (0),
    LineTotal           AS (UnitPrice * Quantity - DiscountAmount) PERSISTED,
    -- Tùy chọn khách
    Size                NVARCHAR(40)       NULL,
    Color               NVARCHAR(40)       NULL,
    CardMessage         NVARCHAR(300)      NULL,
    PersonalNote        NVARCHAR(300)      NULL,
    CONSTRAINT CK_OrderItems_Qty      CHECK (Quantity > 0),
    CONSTRAINT CK_OrderItems_Price    CHECK (UnitPrice > 0),
    CONSTRAINT CK_OrderItems_Discount CHECK (DiscountAmount >= 0 AND DiscountAmount <= UnitPrice * Quantity)
);
CREATE INDEX IX_OrderItems_Order   ON dbo.OrderItems (OrderId);
CREATE INDEX IX_OrderItems_Product ON dbo.OrderItems (ProductId);
GO

/* Giá trong đơn đã tạo không được sửa. */
CREATE TRIGGER dbo.TR_OrderItems_LockPrice ON dbo.OrderItems
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(UnitPrice) OR UPDATE(Quantity) OR UPDATE(DiscountAmount) OR UPDATE(ProductId) OR UPDATE(ProductPriceId)
        THROW 50003, N'Không được sửa giá, số lượng hoặc sản phẩm của đơn đã tạo.', 1;
END;
GO

CREATE TABLE dbo.OrderStatusHistory (
    Id                BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderStatusHistory PRIMARY KEY,
    OrderId           BIGINT             NOT NULL CONSTRAINT FK_OrderStatusHistory_Orders REFERENCES dbo.Orders (Id) ON DELETE CASCADE,
    Status            VARCHAR(20)        NOT NULL,
    Location          NVARCHAR(200)      NULL,
    EstimatedDelivery NVARCHAR(100)      NULL,
    ChangedBy         INT                NULL CONSTRAINT FK_OrderStatusHistory_Users REFERENCES dbo.Users (Id),
    CreatedAt         DATETIME2(3)       NOT NULL CONSTRAINT DF_OrderStatusHistory_CreatedAt DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_OrderStatusHistory_Order ON dbo.OrderStatusHistory (OrderId, CreatedAt);
GO

/* Nhật ký biến động kho (tạo sau Orders vì có FK tới đơn hàng). */
CREATE TABLE dbo.InventoryMovements (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_InventoryMovements PRIMARY KEY,
    ProductId       INT                NOT NULL CONSTRAINT FK_InventoryMovements_Products REFERENCES dbo.Products (Id),
    QuantityChange  INT                NOT NULL,   -- dương: cộng kho, âm: trừ kho
    StockAfter      INT                NOT NULL,
    MovementType    VARCHAR(20)        NOT NULL,
    OrderId         BIGINT             NULL CONSTRAINT FK_InventoryMovements_Orders REFERENCES dbo.Orders (Id),
    ReceiptItemId   INT                NULL CONSTRAINT FK_InventoryMovements_ReceiptItems REFERENCES dbo.StockReceiptItems (Id),
    Note            NVARCHAR(300)      NULL,
    CreatedBy       INT                NULL CONSTRAINT FK_InventoryMovements_Users REFERENCES dbo.Users (Id),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_InventoryMovements_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_InventoryMovements_Type  CHECK (MovementType IN ('import', 'reserve', 'release', 'adjust', 'return')),
    CONSTRAINT CK_InventoryMovements_Qty   CHECK (QuantityChange <> 0),
    CONSTRAINT CK_InventoryMovements_After CHECK (StockAfter >= 0),
    CONSTRAINT CK_InventoryMovements_Link  CHECK (
        (MovementType IN ('reserve', 'release', 'return') AND OrderId IS NOT NULL)
        OR (MovementType = 'import' AND ReceiptItemId IS NOT NULL)
        OR MovementType = 'adjust')
);
CREATE INDEX IX_InventoryMovements_Product ON dbo.InventoryMovements (ProductId, CreatedAt DESC);
CREATE INDEX IX_InventoryMovements_Order   ON dbo.InventoryMovements (OrderId) WHERE OrderId IS NOT NULL;
GO

/* Trừ kho an toàn: chỉ trừ khi còn đủ, cùng transaction với việc tạo đơn. */
CREATE PROCEDURE dbo.usp_ReserveStock
    @OrderId    BIGINT,
    @ProductId  INT,
    @Quantity   INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Quantity <= 0 THROW 50004, N'Số lượng phải lớn hơn 0.', 1;

    DECLARE @After TABLE (Stock INT);
    UPDATE dbo.Products
    SET Stock = Stock - @Quantity, UpdatedAt = SYSUTCDATETIME()
    OUTPUT inserted.Stock INTO @After
    WHERE Id = @ProductId AND Stock >= @Quantity;

    IF NOT EXISTS (SELECT 1 FROM @After)
        THROW 50005, N'Sản phẩm không đủ hàng.', 1;

    INSERT INTO dbo.InventoryMovements (ProductId, QuantityChange, StockAfter, MovementType, OrderId)
    SELECT @ProductId, -@Quantity, Stock, 'reserve', @OrderId FROM @After;
END;
GO

/* Hoàn kho cho đơn hết hạn hoặc bị hủy (gọi một lần cho mỗi đơn). */
CREATE PROCEDURE dbo.usp_ReleaseOrderStock
    @OrderId    BIGINT,
    @NewStatus  VARCHAR(20) = 'expired'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    UPDATE dbo.Orders
    SET InventoryState = 'released', Status = @NewStatus, CancelledAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE Id = @OrderId AND InventoryState = 'reserved';

    IF @@ROWCOUNT = 0
    BEGIN
        COMMIT TRANSACTION;   -- đã hoàn kho trước đó: không làm gì (idempotent)
        RETURN;
    END;

    DECLARE @Qty TABLE (ProductId INT PRIMARY KEY, Quantity INT);
    INSERT INTO @Qty (ProductId, Quantity)
    SELECT ProductId, -SUM(QuantityChange)
    FROM dbo.InventoryMovements
    WHERE OrderId = @OrderId AND MovementType = 'reserve'
    GROUP BY ProductId;

    DECLARE @After TABLE (ProductId INT, Stock INT);
    UPDATE p
    SET Stock = p.Stock + q.Quantity, UpdatedAt = SYSUTCDATETIME()
    OUTPUT inserted.Id, inserted.Stock INTO @After
    FROM dbo.Products p
    JOIN @Qty q ON q.ProductId = p.Id;

    INSERT INTO dbo.InventoryMovements (ProductId, QuantityChange, StockAfter, MovementType, OrderId)
    SELECT a.ProductId, q.Quantity, a.Stock, 'release', @OrderId
    FROM @After a JOIN @Qty q ON q.ProductId = a.ProductId;

    INSERT INTO dbo.OrderStatusHistory (OrderId, Status, Location)
    VALUES (@OrderId, @NewStatus, N'Đơn đã hủy và hoàn kho');

    COMMIT TRANSACTION;
END;
GO

/* =====================================================================
   8. THANH TOÁN VÀ HOÀN TIỀN
   ===================================================================== */

CREATE TABLE dbo.Payments (
    Id                      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Payments PRIMARY KEY,
    OrderId                 BIGINT             NOT NULL CONSTRAINT FK_Payments_Orders REFERENCES dbo.Orders (Id),
    Provider                VARCHAR(10)        NOT NULL,
    TxnRef                  VARCHAR(64)        NOT NULL CONSTRAINT UQ_Payments_TxnRef UNIQUE,   -- mã gửi sang VNPay / nội dung CK
    Attempt                 INT                NOT NULL CONSTRAINT DF_Payments_Attempt DEFAULT (1),
    Amount                  DECIMAL(18,0)      NOT NULL,
    Status                  VARCHAR(20)        NOT NULL CONSTRAINT DF_Payments_Status DEFAULT ('pending'),
    ProviderTransactionNo   VARCHAR(64)        NULL,   -- vnp_TransactionNo / mã giao dịch ngân hàng
    BankCode                VARCHAR(20)        NULL,
    ResponseCode            VARCHAR(10)        NULL,
    RawResponse             NVARCHAR(MAX)      NULL,   -- IPN đã che dữ liệu nhạy cảm
    ExpiresAt               DATETIME2(3)       NULL,
    PaidAt                  DATETIME2(3)       NULL,
    VerifiedBy              INT                NULL CONSTRAINT FK_Payments_Users REFERENCES dbo.Users (Id),  -- admin xác nhận CK thủ công
    ReconciliationReference NVARCHAR(120)      NULL,
    CreatedAt               DATETIME2(3)       NOT NULL CONSTRAINT DF_Payments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Payments_Provider CHECK (Provider IN ('cod', 'qr', 'vnpay')),
    CONSTRAINT CK_Payments_Status   CHECK (Status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
    CONSTRAINT CK_Payments_Amount   CHECK (Amount > 0),
    CONSTRAINT CK_Payments_Raw      CHECK (RawResponse IS NULL OR ISJSON(RawResponse) = 1),
    CONSTRAINT UQ_Payments_Attempt  UNIQUE (OrderId, Attempt)
);
/* Chống IPN gửi trùng: cùng một giao dịch nhà cung cấp chỉ được ghi nhận một lần. */
CREATE UNIQUE INDEX UX_Payments_ProviderTxn ON dbo.Payments (Provider, ProviderTransactionNo) WHERE ProviderTransactionNo IS NOT NULL;
/* Mỗi đơn chỉ có tối đa một lần thanh toán thành công. */
CREATE UNIQUE INDEX UX_Payments_OnePaid ON dbo.Payments (OrderId) WHERE Status = 'paid';
GO

/* Hỗ trợ hoàn một phần và nhiều lần (khắc phục hạn chế hiện tại). */
CREATE TABLE dbo.Refunds (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Refunds PRIMARY KEY,
    PaymentId       BIGINT             NOT NULL CONSTRAINT FK_Refunds_Payments REFERENCES dbo.Payments (Id),
    Amount          DECIMAL(18,0)      NOT NULL,
    Reference       NVARCHAR(120)      NOT NULL,   -- mã giao dịch chuyển trả
    Reason          NVARCHAR(300)      NULL,
    RefundedBy      INT                NOT NULL CONSTRAINT FK_Refunds_Users REFERENCES dbo.Users (Id),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_Refunds_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Refunds_Amount CHECK (Amount > 0)
);
GO

/* Tổng tiền hoàn không vượt quá số đã thanh toán. */
CREATE TRIGGER dbo.TR_Refunds_NotExceedPayment ON dbo.Refunds
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM dbo.Payments p
        JOIN (SELECT DISTINCT PaymentId FROM inserted) i ON i.PaymentId = p.Id
        CROSS APPLY (SELECT SUM(r.Amount) AS Refunded FROM dbo.Refunds r WHERE r.PaymentId = p.Id) s
        WHERE p.Status <> 'paid' OR s.Refunded > p.Amount
    )
        THROW 50006, N'Chỉ hoàn tiền cho khoản đã thanh toán và không vượt quá số tiền đã nhận.', 1;
END;
GO

/* =====================================================================
   9. ĐÁNH GIÁ SẢN PHẨM VÀ LỜI NHẮN
   ===================================================================== */

CREATE TABLE dbo.Reviews (
    Id               BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reviews PRIMARY KEY,
    AuthorUserId     INT                NOT NULL CONSTRAINT FK_Reviews_Users REFERENCES dbo.Users (Id),
    OrderId          BIGINT             NULL CONSTRAINT FK_Reviews_Orders REFERENCES dbo.Orders (Id),  -- đánh giá từ đơn đã mua
    CustomerName     NVARCHAR(120)      NOT NULL,
    Rating           TINYINT            NOT NULL,
    Comment          NVARCHAR(1000)     NOT NULL,
    ModerationStatus VARCHAR(10)        NOT NULL CONSTRAINT DF_Reviews_Moderation DEFAULT ('pending'),
    ModerationReason NVARCHAR(500)      NULL,
    ModeratedBy      INT                NULL CONSTRAINT FK_Reviews_Moderator REFERENCES dbo.Users (Id),
    ModeratedAt      DATETIME2(3)       NULL,
    Reply            NVARCHAR(1000)     NULL,
    CompletedAt      DATETIME2(3)       NULL,
    CreatedAt        DATETIME2(3)       NOT NULL CONSTRAINT DF_Reviews_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Reviews_Rating     CHECK (Rating BETWEEN 1 AND 5),
    CONSTRAINT CK_Reviews_Moderation CHECK (ModerationStatus IN ('pending', 'approved', 'hidden'))
);
/* Mỗi tài khoản chỉ đánh giá một lần cho mỗi đơn. */
CREATE UNIQUE INDEX UX_Reviews_OrderAuthor ON dbo.Reviews (OrderId, AuthorUserId) WHERE OrderId IS NOT NULL;
GO

/* Một đánh giá có thể áp dụng cho nhiều sản phẩm trong cùng đơn (trước đây là mảng productIds). */
CREATE TABLE dbo.ReviewProducts (
    ReviewId        BIGINT             NOT NULL CONSTRAINT FK_ReviewProducts_Reviews REFERENCES dbo.Reviews (Id) ON DELETE CASCADE,
    ProductId       INT                NOT NULL CONSTRAINT FK_ReviewProducts_Products REFERENCES dbo.Products (Id),
    CONSTRAINT PK_ReviewProducts PRIMARY KEY (ReviewId, ProductId)
);
CREATE INDEX IX_ReviewProducts_Product ON dbo.ReviewProducts (ProductId);
GO

CREATE TABLE dbo.ReviewImages (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReviewImages PRIMARY KEY,
    ReviewId        BIGINT             NOT NULL CONSTRAINT FK_ReviewImages_Reviews REFERENCES dbo.Reviews (Id) ON DELETE CASCADE,
    Data            VARBINARY(MAX)     NOT NULL,
    ContentType     VARCHAR(40)        NOT NULL,
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_ReviewImages_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* Lời nhắn khách để lại khi đặt hàng (collection messages). */
CREATE TABLE dbo.CustomerMessages (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerMessages PRIMARY KEY,
    OrderId         BIGINT             NULL CONSTRAINT FK_CustomerMessages_Orders REFERENCES dbo.Orders (Id),
    CustomerName    NVARCHAR(120)      NOT NULL,
    Content         NVARCHAR(1000)     NOT NULL,
    Reply           NVARCHAR(1000)     NULL,
    CompletedAt     DATETIME2(3)       NULL,
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_CustomerMessages_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* =====================================================================
   10. YÊU CẦU THIẾT KẾ BÓ HOA RIÊNG
   ===================================================================== */

CREATE TABLE dbo.DesignRequests (
    Id               BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DesignRequests PRIMARY KEY,
    RequestCode      VARCHAR(32)        NOT NULL CONSTRAINT UQ_DesignRequests_Code UNIQUE,
    AccessTokenHash  VARBINARY(32)      NOT NULL,   -- khách vãng lai xem yêu cầu bằng token (chỉ lưu bản băm)
    UserId           INT                NULL CONSTRAINT FK_DesignRequests_Users REFERENCES dbo.Users (Id),
    CustomerName     NVARCHAR(120)      NOT NULL,
    Phone            VARCHAR(20)        NOT NULL,
    DeliveryZoneId   INT                NULL CONSTRAINT FK_DesignRequests_Zones REFERENCES dbo.DeliveryZones (Id),
    DeliveryProvince NVARCHAR(120)      NULL,
    DeliveryDistrict NVARCHAR(120)      NULL,
    DeliveryDate     DATE               NULL,
    Design           NVARCHAR(MAX)      NOT NULL,   -- JSON: arrangement, size, wrapStyle, palette, theme...
    SpecialRequest   NVARCHAR(1500)     NULL,
    EstimatedTotal   DECIMAL(18,0)      NOT NULL CONSTRAINT DF_DesignRequests_Estimated DEFAULT (0),
    QuotedTotal      DECIMAL(18,0)      NULL,
    QuoteNote        NVARCHAR(1000)     NULL,
    Status           VARCHAR(20)        NOT NULL CONSTRAINT DF_DesignRequests_Status DEFAULT ('consulting'),
    ConvertedOrderId BIGINT             NULL CONSTRAINT FK_DesignRequests_Orders REFERENCES dbo.Orders (Id),
    CreatedAt        DATETIME2(3)       NOT NULL CONSTRAINT DF_DesignRequests_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(3)       NOT NULL CONSTRAINT DF_DesignRequests_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_DesignRequests_Design CHECK (ISJSON(Design) = 1),
    CONSTRAINT CK_DesignRequests_Status CHECK (Status IN ('consulting', 'quoting', 'awaiting_customer', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT CK_DesignRequests_Money  CHECK (EstimatedTotal >= 0 AND (QuotedTotal IS NULL OR QuotedTotal >= 0))
);
CREATE INDEX IX_DesignRequests_Status ON dbo.DesignRequests (Status, CreatedAt DESC);
GO

CREATE TABLE dbo.DesignRequestStems (
    RequestId       BIGINT             NOT NULL CONSTRAINT FK_DesignRequestStems_Requests REFERENCES dbo.DesignRequests (Id) ON DELETE CASCADE,
    ProductId       INT                NOT NULL CONSTRAINT FK_DesignRequestStems_Products REFERENCES dbo.Products (Id),
    Quantity        INT                NOT NULL,
    UnitPrice       DECIMAL(18,0)      NOT NULL,   -- giá cành lúc khách gửi yêu cầu (chỉ để ước tính)
    CONSTRAINT PK_DesignRequestStems PRIMARY KEY (RequestId, ProductId),
    CONSTRAINT CK_DesignRequestStems_Qty CHECK (Quantity > 0)
);
GO

CREATE TABLE dbo.DesignRequestHistory (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DesignRequestHistory PRIMARY KEY,
    RequestId       BIGINT             NOT NULL CONSTRAINT FK_DesignRequestHistory_Requests REFERENCES dbo.DesignRequests (Id) ON DELETE CASCADE,
    Status          VARCHAR(20)        NOT NULL,
    Note            NVARCHAR(1000)     NULL,
    ChangedBy       INT                NULL CONSTRAINT FK_DesignRequestHistory_Users REFERENCES dbo.Users (Id),
    CreatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_DesignRequestHistory_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* =====================================================================
   11. GIỎ HÀNG VÀ YÊU THÍCH (tiện ích của khách, không phải nguồn giá)
   ===================================================================== */

CREATE TABLE dbo.CartItems (
    UserId          INT                NOT NULL CONSTRAINT FK_CartItems_Users REFERENCES dbo.Users (Id) ON DELETE CASCADE,
    LineKey         VARCHAR(100)       NOT NULL,   -- productId + tùy chọn, hoặc mã bó tự chọn
    ProductId       INT                NOT NULL CONSTRAINT FK_CartItems_Products REFERENCES dbo.Products (Id),
    Quantity        INT                NOT NULL,
    Options         NVARCHAR(1000)     NULL,       -- JSON: size, color, cardMessage, customBouquetId...
    UpdatedAt       DATETIME2(3)       NOT NULL CONSTRAINT DF_CartItems_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_CartItems PRIMARY KEY (UserId, LineKey),
    CONSTRAINT CK_CartItems_Qty     CHECK (Quantity BETWEEN 1 AND 999),
    CONSTRAINT CK_CartItems_Options CHECK (Options IS NULL OR ISJSON(Options) = 1)
);
GO

CREATE TABLE dbo.WishlistItems (
    UserId          INT                NOT NULL CONSTRAINT FK_WishlistItems_Users REFERENCES dbo.Users (Id) ON DELETE CASCADE,
    ProductId       INT                NOT NULL CONSTRAINT FK_WishlistItems_Products REFERENCES dbo.Products (Id),
    AddedAt         DATETIME2(3)       NOT NULL CONSTRAINT DF_WishlistItems_AddedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_WishlistItems PRIMARY KEY (UserId, ProductId)
);
GO

/* =====================================================================
   12. DỮ LIỆU VẬN HÀNH
   ===================================================================== */

/* Giới hạn số lần thử (tra cứu đơn, tạo đơn, đăng nhập sai). Khóa đã băm HMAC. */
CREATE TABLE dbo.RateLimitCounters (
    Scope           VARCHAR(30)        NOT NULL,   -- order_lookup | order_create | login
    KeyHash         VARBINARY(32)      NOT NULL,
    Count           INT                NOT NULL,
    LockedUntil     DATETIME2(3)       NULL,
    ExpiresAt       DATETIME2(3)       NOT NULL,
    CONSTRAINT PK_RateLimitCounters PRIMARY KEY (Scope, KeyHash),
    CONSTRAINT CK_RateLimitCounters_Count CHECK (Count >= 0)
);
CREATE INDEX IX_RateLimitCounters_Expires ON dbo.RateLimitCounters (ExpiresAt);
GO

/* =====================================================================
   13. VIEW BÁO CÁO
   ===================================================================== */

/* Doanh thu theo ngày (giờ Việt Nam): đơn đã giao, trừ tiền đã hoàn. */
CREATE VIEW dbo.vw_DailyRevenue
AS
SELECT
    CAST(SWITCHOFFSET(CAST(o.CreatedAt AS DATETIMEOFFSET), '+07:00') AS DATE) AS SalesDate,
    COUNT(*)                                     AS OrderCount,
    SUM(o.Total)                                 AS GrossRevenue,
    SUM(ISNULL(r.Refunded, 0))                   AS Refunded,
    SUM(o.Total) - SUM(ISNULL(r.Refunded, 0))    AS NetRevenue
FROM dbo.Orders o
OUTER APPLY (
    SELECT SUM(rf.Amount) AS Refunded
    FROM dbo.Payments p
    JOIN dbo.Refunds rf ON rf.PaymentId = p.Id
    WHERE p.OrderId = o.Id
) r
WHERE o.Status = 'delivered'
GROUP BY CAST(SWITCHOFFSET(CAST(o.CreatedAt AS DATETIMEOFFSET), '+07:00') AS DATE);
GO

/* Ưu đãi đang có hiệu lực hôm nay. */
CREATE VIEW dbo.vw_ActivePromotions
AS
SELECT p.*
FROM dbo.Promotions p
WHERE p.IsActive = 1
  AND (p.StartDate IS NULL OR p.StartDate <= CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS DATE))
  AND (p.EndDate   IS NULL OR p.EndDate   >= CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS DATE));
GO
