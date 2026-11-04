(function initializeRelatedProducts(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerRelatedProducts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRelatedProductsModule() {
  const flowerPatterns = [
    /\broses?\b|hoa hồng/i,
    /\borchids?\b|hoa lan/i,
    /\blil(?:y|ies)\b|hoa ly/i,
    /\blavender\b|oải hương/i,
    /\bgerbers?\b|\bdais(?:y|ies)\b|hoa đồng tiền/i
  ];

  function productSignals(product) {
    const signals = new Set();
    const category = String(product.category || "").trim().toLocaleLowerCase("vi");
    if (category) signals.add(`category:${category}`);

    const searchableText = `${product.title || ""} ${product.description || ""}`;
    flowerPatterns.forEach((pattern, index) => {
      if (pattern.test(searchableText)) signals.add(`flower:${index}`);
    });
    return signals;
  }

  function getRelatedProducts(products, currentProduct, limit = 4) {
    if (!Array.isArray(products) || !currentProduct || typeof currentProduct !== "object") return [];
    const maxResults = Number.isInteger(limit) && limit > 0 ? limit : 4;
    const currentId = currentProduct.id === undefined || currentProduct.id === null
      ? null
      : String(currentProduct.id);
    const currentTitle = String(currentProduct.title || "").trim().toLocaleLowerCase("vi");
    const currentSignals = productSignals(currentProduct);
    const seenIds = new Set();
    const seenTitles = new Set();

    const candidates = products.filter((product) => {
      if (!product || typeof product !== "object") return false;
      const id = product.id === undefined || product.id === null ? null : String(product.id);
      const title = String(product.title || "").trim().toLocaleLowerCase("vi");
      if ((currentId !== null && id === currentId) || (currentTitle && title === currentTitle)) return false;
      if (id !== null && seenIds.has(id)) return false;
      if (title && seenTitles.has(title)) return false;
      if (id !== null) seenIds.add(id);
      if (title) seenTitles.add(title);
      return true;
    }).map((product, index) => {
      const signals = productSignals(product);
      let score = 0;
      signals.forEach((signal) => {
        if (currentSignals.has(signal)) score += signal.startsWith("category:") ? 4 : 2;
      });
      return { product, index, score };
    });

    candidates.sort((first, second) => second.score - first.score || first.index - second.index);
    return candidates.slice(0, maxResults).map(({ product }) => product);
  }

  return { getRelatedProducts };
});
