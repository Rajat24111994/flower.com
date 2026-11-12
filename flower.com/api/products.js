// Hàm Vercel cho /api/products (và /api/flower-prices qua rewrite trong vercel.json).
// Toàn bộ xử lý nằm trong module backend/catalog.
module.exports = require("../backend/catalog/products");
