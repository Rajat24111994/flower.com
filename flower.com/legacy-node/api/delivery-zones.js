// Hàm Vercel cho /api/delivery-zones (và /api/bouquet-wrapping qua rewrite trong vercel.json).
// Toàn bộ xử lý nằm trong module backend/shop-settings.
module.exports = require("../backend/shop-settings/delivery-zones");
