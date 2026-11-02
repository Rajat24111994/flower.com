(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowerProductSales = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function adjustment(order, nextStatus, restockSold) {
    const counted = order.salesCounted === true;
    if (nextStatus === "Đã giao" && !counted) return 1;
    if (nextStatus === "Đã hủy" && restockSold === true && counted) return -1;
    return 0;
  }
  return { adjustment };
});
