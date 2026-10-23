(function initializeProductCategories(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerProductCategories = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createProductCategories() {
  const categories = {
    birthday: {
      title: "Hoa tặng sinh nhật",
      description: "Những bó hoa rực rỡ dành cho ngày sinh nhật đáng nhớ.",
      categoryKey: "birthday",
      keywords: ["birthday", "party", "celebration", "sinh nhat"]
    },
    sympathy: {
      title: "Hoa chia buồn",
      description: "Những vòng hoa trang nhã để gửi lời tiễn biệt và sẻ chia chân thành.",
      categoryKey: "sympathy",
      keywords: ["sympathy", "condolence", "funeral", "memorial", "remembrance", "chia buon"]
    },
    occasion: {
      title: "Hoa cho dịp đặc biệt",
      description: "Khám phá hoa dành cho những dịp và khoảnh khắc đáng nhớ.",
      categoryKey: "occasion",
      keywords: ["anniversary", "wedding", "romance", "love", "valentine", "occasion", "congratulation", "dip dac biet"]
    },
    flowers: {
      title: "Hoa tươi",
      description: "Chọn một bó hoa tươi để gửi lời yêu thương.",
      categoryKey: "flowers",
      keywords: []
    },
    plants: {
      title: "Cây cảnh",
      description: "Thêm sắc xanh thư thái cho góc nhà và không gian làm việc.",
      categoryKey: "plants",
      keywords: ["plant", "succulent", "cactus", "bonsai", "cay canh"]
    },
    gift: {
      title: "Quà tặng",
      description: "Những bó hoa và giỏ quà phù hợp để gửi tặng người thương.",
      categoryKey: "gift",
      keywords: ["gift", "present", "basket", "qua tang"]
    },
    food: {
      title: "Giỏ quà & thực phẩm",
      description: "Những món quà ngọt ngào và giỏ trái cây dành tặng người thân.",
      categoryKey: "food",
      keywords: ["fruit", "chocolate", "food", "snack", "gio qua", "thuc pham"]
    },
    delivery: {
      title: "Giao hoa trong ngày",
      description: "Chọn những mẫu hoa được đánh dấu hỗ trợ giao trong ngày.",
      sameDayDeliveryOnly: true
    },
    sale: {
      title: "Ưu đãi",
      description: "Khám phá những mẫu hoa đang có mức giá ưu đãi.",
      saleOnly: true
    }
  };

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("vi")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  }

  function getCategory(key) {
    return categories[key] || null;
  }

  function matchesCategory(product, key) {
    const category = getCategory(key);
    if (!category) return true;
    if (category.sameDayDeliveryOnly) return product.sameDayDelivery === true;
    if (category.saleOnly) return product.onSale === true;
    if (product.categoryKey) return product.categoryKey === category.categoryKey;
    if (key === "flowers") return !/(plant|succulent|cactus|bonsai|cay canh)/.test(normalize(product.category));
    if (!category.keywords.length) return true;

    const details = normalize([
      product.category,
      product.title,
      product.description
    ].join(" "));
    return category.keywords.some((keyword) => details.includes(normalize(keyword)));
  }

  return { getCategory, matchesCategory };
});
