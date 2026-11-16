const vnpay = require('../../../flower.com/backend/payments/vnpay');
const crypto = require('node:crypto');
const config = vnpay.getVnpayConfig({ VNPAY_TMN_CODE: 'TEST', VNPAY_HASH_SECRET: 'test-secret', PUBLIC_APP_URL: 'https://example.invalid/path' });
const now = '2026-11-15T17:30:00.000Z', expires = '2026-11-15T17:45:00.000Z';
const queryCases = [
  { vnp_Z: 'hello world!~*() tiếng Việt', vnp_A: 123, ignored: 'x', vnp_SecureHashType: 'SHA512', vnp_SecureHash: 'fake' },
  { vnp_empty: '', vnp_null: null, vnp_false: false, vnp_zero: 0, vnp_array: ['a', 'b'], vnp_object: {} }
];
const queries = queryCases.map(input => {
  const hash = crypto.createHmac('sha512', 'test-secret').update(vnpay.canonicalQuery(input)).digest('hex');
  return { input: { ...input, vnp_SecureHash: hash.toUpperCase() }, expected: vnpay.canonicalQuery(input), valid: true };
});
queries.push({ input: { vnp_Amount: '1', vnp_SecureHash: 'a'.repeat(128) }, expected: 'vnp_Amount=1', valid: false });
const urls = ['127.0.0.1', '127.1', '01.2.3.4', '::1', '[::1]', 'bad'].map(ipAddress => ({
  ipAddress, expected: vnpay.createVnpayPaymentUrl({ txnRef: 'FFabc123', amount: 123456, ipAddress, createdAt: now, expiresAt: expires }, config)
}));
process.stdout.write(JSON.stringify({ queries, urls, now, expires }));
