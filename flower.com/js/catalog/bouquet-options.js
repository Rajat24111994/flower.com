(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerBouquetOptions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const sizes = [
    { id: "standard", label: "Tiêu chuẩn", percent: 100 },
    { id: "large", label: "Lớn", percent: 130 },
    { id: "premium", label: "Cao cấp", percent: 160 }
  ];
  const colors = [
    { id: "original", label: "Như ảnh mẫu" }, { id: "pink", label: "Hồng pastel" },
    { id: "white", label: "Trắng kem" }, { id: "red", label: "Đỏ ấm" }
  ];
  function normalize(item) {
    if (item.productId === undefined && item.size === undefined && item.color === undefined
      && item.cardMessage === undefined && item.personalNote === undefined) return {};
    const productId = String(item.productId ?? item.id ?? "").trim();
    const size = String(item.size || "standard");
    const color = String(item.color || "original");
    const cardMessage = String(item.cardMessage || "").trim();
    const personalNote = String(item.personalNote || "").trim();
    if (!productId || productId.length > 128 || productId.includes("/")
      || !sizes.some((option) => option.id === size) || !colors.some((option) => option.id === color)
      || cardMessage.length > 300 || personalNote.length > 500) return null;
    return { productId, size, color, cardMessage, personalNote };
  }
  function price(basePrice, size = "standard") {
    const option = sizes.find((item) => item.id === size);
    if (!option) throw new Error("Kích thước bó hoa không hợp lệ.");
    return Math.round(Number(basePrice) * option.percent / 100);
  }
  function summary(item) {
    if (!item.productId) return "";
    return [sizes.find((option) => option.id === item.size)?.label,
      colors.find((option) => option.id === item.color)?.label,
      item.cardMessage && `Thiệp: ${item.cardMessage}`,
      item.personalNote && `Ghi chú: ${item.personalNote}`].filter(Boolean).join(" · ");
  }
  function demand(items, productId) {
    return items.filter((item) => String(item.productId ?? item.id) === String(productId))
      .reduce((total, item) => total + Number(item.quantity ?? 1), 0);
  }
  return { sizes, colors, normalize, price, summary, demand };
});
