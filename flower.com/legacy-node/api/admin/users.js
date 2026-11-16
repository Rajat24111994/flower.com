// Hàm Vercel cho /api/admin/users (và /api/admin/audit qua rewrite trong vercel.json).
// Toàn bộ xử lý nằm trong module backend/admin.
module.exports = require("../../backend/admin/users");
