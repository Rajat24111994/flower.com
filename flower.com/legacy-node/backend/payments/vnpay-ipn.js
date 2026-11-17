module.exports = async function handler(req, res) {
  return res.status(410).json({ code: "payment-method-removed", error: "Vui lòng thanh toán bằng QR chuyển khoản." });
};
