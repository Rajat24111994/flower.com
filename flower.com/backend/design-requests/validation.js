// Quy tắc dữ liệu của yêu cầu thiết kế bó hoa: danh sách lựa chọn, kiểm tra thiết kế, cành hoa,
// ảnh tham khảo, mã truy cập của khách và dữ liệu trả về công khai.
const { createHash, timingSafeEqual } = require("node:crypto");
const bouquetWrapping = require("../../js/catalog/bouquet-wrapping.js");

const STATUSES = ["Chờ tư vấn", "Chờ báo giá", "Chờ khách xác nhận", "Đang thực hiện", "Hoàn thành", "Đã hủy"];
const COLORS = ["trắng", "đen", "kem", "hồng", "đỏ", "vàng", "cam", "xanh", "tím", "nhiều màu", "khác"];
const TEXT_LIMITS = {
    arrangement: 40, size: 20, wrapStyle: 40, paperMaterial: 40, paperColor: 30,
    bowStyle: 30, bowColor: 30, theme: 40, style: 40, palette: 40,
    greetingCardTemplate: 40, greetingCard: 300, fragrance: 30, specialRequest: 1500, deliveryNote: 500,
    quoteNote: 1000
};
const DESIGN_CHOICES = {
    arrangement: ["Đối xứng", "Tự nhiên", "Hoa chính ở giữa", "Hoa xen kẽ"],
    size: ["Mini", "Nhỏ", "Vừa", "Lớn"],
    wrapStyle: ["Bó tròn", "Bó dài", "Bó một mặt", "Bó Hàn Quốc", "Bó tối giản", "Không gói"],
    paperMaterial: ["Giấy kraft", "Giấy nhám", "Giấy Hàn Quốc", "Giấy bóng kính"],
    bowStyle: ["Nơ nhỏ", "Nơ lớn", "Nơ lụa", "Không nơ"],
    theme: ["Sinh nhật", "Tình yêu", "Tốt nghiệp", "Khai trương", "Cảm ơn", "Kỷ niệm", "Ngày lễ", "Tự chọn"],
    style: ["Lãng mạn", "Sang trọng", "Dễ thương", "Tối giản", "Cổ điển", "Tự nhiên"],
    palette: ["Trắng - kem", "Hồng pastel", "Đỏ ấm", "Vàng tươi", "Xanh dịu", "Tím", "Nhiều màu"],
    greetingCardTemplate: ["Không cần thiệp", "Hoa lá", "Tối giản", "Chúc mừng", "Tình cảm"]
};

function cleanText(value, maxLength) {
    const text = String(value || "").trim();
    return text.length <= maxLength ? text : null;
}

function canonicalColor(value) {
    const key = String(value || "").trim().toLocaleLowerCase("vi");
    const aliases = { white: "trắng", black: "đen", cream: "kem", pink: "hồng", red: "đỏ", yellow: "vàng", orange: "cam", green: "xanh", blue: "xanh", purple: "tím", multicolor: "nhiều màu" };
    return aliases[key] || key;
}

function validImage(dataUri) {
    if (!dataUri) return "";
    if (typeof dataUri !== "string" || dataUri.length > 360000) return null;
    const match = dataUri.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64") !== match[2]) return null;
    if (bytes.length < 12 || bytes.length > 250000) return null;
    const valid = match[1] === "png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === "jpeg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    return valid ? dataUri : null;
}

function parseDesign(value = {}) {
    const design = {};
    for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
        const cleaned = cleanText(value[key], limit);
        if (cleaned === null) return null;
        if (cleaned) design[key] = cleaned;
    }
    design.paperLayers = Number(value.paperLayers || 1);
    design.mainProductId = String(value.mainProductId || "");
    if (design.mainProductId.length > 128 || design.mainProductId.includes("/")) return null;
    design.greenery = value.greenery === true;
    design.addons = Array.isArray(value.addons)
        ? [...new Set(value.addons.map((item) => String(item)).filter((item) => ["gấu bông nhỏ", "hộp quà", "túi quà", "chocolate", "hoa baby phụ"].includes(item)))]
        : [];
    if (Array.isArray(value.addons) && design.addons.length !== new Set(value.addons).size) return null;
    design.surprise = value.surprise === true;
    design.confirmBeforeMaking = value.confirmBeforeMaking !== false;
    design.anonymousGreetingCard = value.anonymousGreetingCard === true;
    design.lowFragrance = value.lowFragrance === true;
    design.dislikedFlowers = Array.isArray(value.dislikedFlowers)
        ? [...new Set(value.dislikedFlowers.map((item) => String(item).trim()).filter((item) => item && item.length <= 60))].slice(0, 10)
        : [];
    design.excludedFlowers = Array.isArray(value.excludedFlowers)
        ? [...new Set(value.excludedFlowers.map((item) => String(item).trim()).filter((item) => item && item.length <= 60))].slice(0, 10)
        : [];
    design.budget = value.budget === "" || value.budget == null ? 0 : Number(value.budget);
    if (!Number.isInteger(design.paperLayers) || design.paperLayers < 0 || design.paperLayers > 5
        || !Number.isSafeInteger(design.budget) || design.budget < 0 || design.budget > 1000000000
        || Object.entries(DESIGN_CHOICES).some(([key, choices]) => design[key] && !choices.includes(design[key]))
        || (design.paperColor && !COLORS.includes(design.paperColor.toLocaleLowerCase("vi")))
        || (design.bowColor && !COLORS.includes(design.bowColor.toLocaleLowerCase("vi")))) return null;
    return design;
}

function normalizeStems(value) {
    if (!Array.isArray(value) || value.length > 20) return null;
    const seen = new Set();
    const stems = [];
    for (const item of value) {
        const productId = String(item?.productId || "").trim();
        const quantity = Number(item?.quantity);
        const color = cleanText(item?.color, 30);
        const role = String(item?.role || "support");
        if (!productId || productId.length > 128 || productId.includes("/") || seen.has(productId)
            || !Number.isInteger(quantity) || quantity < 1 || quantity > 50
            || !color || !COLORS.includes(color.toLocaleLowerCase("vi"))
            || !["main", "support"].includes(role)) return null;
        seen.add(productId);
        stems.push({ productId, quantity, color, role });
    }
    if (stems.reduce((sum, item) => sum + item.quantity, 0) > bouquetWrapping.MAX_STEMS_PER_BOUQUET) return null;
    return stems;
}

function safeDate(value) {
    return value?.toDate?.().toISOString() || value || "";
}

function publicRequest(id, data) {
    const { accessTokenHash, ...safeData } = data;
    return {
        id,
        ...safeData,
        createdAt: safeDate(data.createdAt),
        updatedAt: safeDate(data.updatedAt),
        history: (Array.isArray(data.history) ? data.history : []).map((event) => ({
            ...event,
            createdAt: safeDate(event.createdAt)
        }))
    };
}

function validAccessToken(token, savedHash) {
    if (typeof token !== "string" || token.length < 32 || token.length > 100 || typeof savedHash !== "string") return false;
    const received = createHash("sha256").update(token).digest();
    const expected = Buffer.from(savedHash, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
}

function addHistory(status, detail = "") {
    return { status, detail: String(detail || "").slice(0, 500), createdAt: new Date().toISOString() };
}

module.exports = { STATUSES, COLORS, TEXT_LIMITS, DESIGN_CHOICES, cleanText, canonicalColor, validImage, parseDesign, normalizeStems, safeDate, publicRequest, validAccessToken, addHistory };
