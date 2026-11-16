(function initializeBouquetWrapping(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerBouquetWrapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBouquetWrapping() {
  const MAX_STEMS_PER_BOUQUET = 50;
  const MAX_TIERS = 10;

  function normalizeTiers(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TIERS) return null;
    let previousMax = 0;
    const tiers = [];
    for (const tier of value) {
      const maxStems = tier?.maxStems;
      const fee = tier?.fee;
      if (!Number.isSafeInteger(maxStems) || maxStems <= previousMax || maxStems > MAX_STEMS_PER_BOUQUET
        || !Number.isSafeInteger(fee) || fee < 0 || fee > 1000000000) return null;
      tiers.push({ maxStems, fee });
      previousMax = maxStems;
    }
    return previousMax === MAX_STEMS_PER_BOUQUET ? tiers : null;
  }

  function feeForStemCount(tiers, stemCount) {
    const normalized = normalizeTiers(tiers);
    if (!normalized || !Number.isSafeInteger(stemCount) || stemCount < 1 || stemCount > MAX_STEMS_PER_BOUQUET) return null;
    return normalized.find((tier) => stemCount <= tier.maxStems)?.fee ?? null;
  }

  function feeForDesign(tiers, stemCount, design = {}) {
    if (!Number.isSafeInteger(stemCount) || stemCount < 1 || stemCount > MAX_STEMS_PER_BOUQUET) return null;
    if (design.wrapStyle === "Không gói" || Number(design.paperLayers) === 0) return 0;
    return feeForStemCount(tiers, stemCount);
  }

  return { MAX_STEMS_PER_BOUQUET, MAX_TIERS, normalizeTiers, feeForStemCount, feeForDesign };
});
