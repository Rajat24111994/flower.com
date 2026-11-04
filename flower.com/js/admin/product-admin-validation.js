(function initializeProductAdminValidation(root) {
    const UNCATEGORIZED = "__uncategorized__";
    const PRODUCT_STATUSES = ["active", "hidden"];

    function safeImageUrl(value) {
        const source = String(value || "").trim();
        if (!source) return false;
        try {
            return ["http:", "https:"].includes(new URL(source, "https://flowerflow.local").protocol);
        } catch {
            return false;
        }
    }

    function validateProductInput(input = {}, categories = []) {
        const title = String(input.title || "").trim();
        const description = String(input.description || "").trim();
        const image = String(input.image || "").trim();
        const imageLines = String(input.images || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        const category = String(input.category || "");
        const priceText = String(input.price ?? "").trim();
        const quantityText = String(input.quantity ?? "").trim();
        const price = Number(priceText);
        const quantity = Number(quantityText);
        const meaning = String(input.meaning || "").trim();
        const colorsText = String(input.colors || "");
        const occasionsText = String(input.occasions || "");
        const status = String(input.status || "active");
        const errors = {};

        if (!title) errors.title = "Vui lòng nhập tên sản phẩm.";
        else if (title.length > 120) errors.title = "Tên sản phẩm không được vượt quá 120 ký tự.";
        if (!safeImageUrl(image)) errors.image = "Nhập đường dẫn ảnh đại diện hợp lệ (http hoặc https).";
        if (imageLines.length > 8) errors.images = "Chỉ được thêm tối đa 8 ảnh phụ.";
        else if (imageLines.some((value) => !safeImageUrl(value))) errors.images = "Mỗi ảnh phụ phải có đường dẫn http hoặc https hợp lệ.";
        if (category !== UNCATEGORIZED && !categories.includes(category)) {
            errors.category = "Vui lòng chọn một danh mục hợp lệ hoặc chọn Chưa phân loại.";
        }
        if (!priceText || !Number.isSafeInteger(price) || price < 1000) {
            errors.price = "Giá phải là số nguyên VND từ 1.000 trở lên (ví dụ 450000).";
        }
        if (!quantityText || !/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantity)) {
            errors.quantity = "Số lượng phải là số nguyên từ 0 trở lên.";
        }
        if (!description) errors.description = "Vui lòng nhập mô tả sản phẩm.";
        else if (description.length > 1000) errors.description = "Mô tả không được vượt quá 1.000 ký tự.";
        if (meaning.length > 1000) errors.meaning = "Ý nghĩa hoa không được vượt quá 1.000 ký tự.";
        if (colorsText.length > 200) errors.colors = "Thông tin màu hoa không được vượt quá 200 ký tự.";
        if (occasionsText.length > 300) errors.occasions = "Dịp tặng không được vượt quá 300 ký tự.";
        if (!PRODUCT_STATUSES.includes(status)) errors.status = "Trạng thái sản phẩm không hợp lệ.";

        if (Object.keys(errors).length) return { product: null, errors };

        const splitTags = (value) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
        return {
            product: {
                title,
                description,
                image,
                images: [...new Set(imageLines)],
                category: category === UNCATEGORIZED ? "" : category,
                price,
                quantity,
                meaning,
                colors: splitTags(colorsText),
                occasions: splitTags(occasionsText),
                status
            },
            errors
        };
    }

    const api = { UNCATEGORIZED, validateProductInput, safeImageUrl };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.FlowerProductAdminValidation = api;
})(typeof window !== "undefined" ? window : null);
