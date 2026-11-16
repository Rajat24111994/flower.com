(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerCatalogSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalize(value) {
    return String(value ?? "").toLocaleLowerCase("vi").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
  }
  const flowers = {
    rose: ["Hoa hồng", "rose", "roses", "hoa hong", "bo hong"],
    orchid: ["Hoa lan", "orchid", "orchids", "hoa lan", "lan ho diep"],
    lily: ["Hoa ly", "lily", "lilies", "hoa ly"],
    lavender: ["Hoa oải hương", "lavender", "oai huong"],
    gerber: ["Hoa đồng tiền", "gerbera", "gerberas", "gerber", "dong tien"],
    tulip: ["Hoa tulip", "tulip", "tulips"],
    hydrangea: ["Hoa cẩm tú cầu", "hydrangea", "hydrangeas", "cam tu cau"],
    peony: ["Hoa mẫu đơn", "peony", "peonies", "mau don"],
    carnation: ["Hoa cẩm chướng", "carnation", "carnations", "cam chuong"],
    sunflower: ["Hoa hướng dương", "sunflower", "sunflowers", "huong duong"],
    babyBreath: ["Hoa bi", "baby breath", "babys breath", "baby s breath", "gypsophila", "hoa bi"],
    iris: ["Hoa diên vĩ", "iris", "irises", "dien vi"],
    chrysanthemum: ["Hoa cúc", "chrysanthemum", "daisy", "daisies", "hoa cuc", "cuc tana"]
  };
  const phrase = (text, value) => (` ${text} `).includes(` ${normalize(value)} `);
  function flowerTypes(product) {
    const text = normalize([product.title, product.description, product.category,
      ...(Array.isArray(product.flowerTypes) ? product.flowerTypes : [])].join(" "));
    const types = Object.entries(flowers).filter(([, aliases]) => aliases.some((alias) => phrase(text, alias))).map(([id]) => id);
    return types.length === 1 ? types : [...types, "mixed"];
  }
  function matchesColor(product, color) {
    if (!color) return true;
    if (Array.isArray(product.colors) && product.colors.length) return product.colors.some((value) => normalize(value) === normalize(color));
    const description = normalize(product.description);
    const palette = description.match(/phoi sac (.*?)(?: bo | gio | ke | chau | moi loai|$)/)?.[1];
    return phrase(palette || normalize(`${product.title || ""} ${product.description || ""}`).replace(/hoa hong|bo hong/g, ""), color);
  }
  function matchesOccasion(product, occasion) {
    if (!occasion) return true;
    if (Array.isArray(product.occasions) && product.occasions.length) return product.occasions.some((value) => normalize(value) === normalize(occasion));
    return phrase(normalize(`${product.title || ""} ${product.description || ""}`), occasion);
  }
  function search(products, filters = {}, displayName = (product) => product.title) {
    const query = normalize(filters.query);
    const tokens = query.split(" ").filter(Boolean);
    const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
    const rows = products.map((product, index) => {
      const types = flowerTypes(product);
      const title = normalize(displayName(product));
      const text = normalize([title, product.title, product.description, product.category,
        ...types.flatMap((type) => flowers[type] || [])].join(" "));
      return { product, index, title, types, text, score: query && phrase(title, query) ? 2 : query && title.includes(query) ? 1 : 0 };
    }).filter(({ product, types, text }) => {
      const price = Number(product.price);
      return tokens.every((token) => text.includes(token))
        && (!filters.flower || (filters.flower.startsWith("category:")
          ? normalize(product.category) === normalize(filters.flower.slice(9)) : types.includes(filters.flower)))
        && (filters.min === undefined || price >= filters.min)
        && (filters.max === undefined || price <= filters.max)
        && matchesColor(product, filters.color) && matchesOccasion(product, filters.occasion);
    });
    const nameOrder = (a, b) => collator.compare(displayName(a.product), displayName(b.product)) || a.index - b.index;
    rows.sort((a, b) => {
      switch (filters.sort) {
        case "asc-p": return a.product.price - b.product.price || nameOrder(a, b);
        case "dsc-p": return b.product.price - a.product.price || nameOrder(a, b);
        case "popular": return (Number(b.product.soldCount) || 0) - (Number(a.product.soldCount) || 0) || nameOrder(a, b);
        case "str-i": return nameOrder(a, b);
        case "str-d": return -nameOrder(a, b);
        case "newest": {
          const date = (p) => Date.parse(p.createdAt || p.updatedAt || "") || Number(p.id) || 0;
          return date(b.product) - date(a.product) || nameOrder(a, b);
        }
        default: return b.score - a.score || a.index - b.index;
      }
    });
    return rows.map(({ product }) => product);
  }
  // Occasions offered in the shop's filter: the usual ones first, then every occasion the admin
  // set on a product (admin → Sản phẩm → "Dịp tặng"), without duplicates.
  const defaultOccasions = ["Sinh nhật", "Kỷ niệm", "Khai trương", "Tốt nghiệp", "Chúc mừng", "Cảm ơn", "Tân gia", "Thăm hỏi"];
  function occasionOptions(products) {
    const seen = new Set();
    const options = [];
    const add = (value) => {
      const label = String(value ?? "").trim().replace(/\s+/g, " ");
      const key = normalize(label);
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push(label.charAt(0).toLocaleUpperCase("vi") + label.slice(1));
    };
    defaultOccasions.forEach(add);
    const custom = [];
    (Array.isArray(products) ? products : []).forEach((product) => {
      (Array.isArray(product?.occasions) ? product.occasions : []).forEach((value) => custom.push(value));
    });
    custom.sort((first, second) => String(first).localeCompare(String(second), "vi")).forEach(add);
    return options;
  }
  return { normalize, flowers, flowerTypes, search, matchesColor, matchesOccasion, occasionOptions };
});
