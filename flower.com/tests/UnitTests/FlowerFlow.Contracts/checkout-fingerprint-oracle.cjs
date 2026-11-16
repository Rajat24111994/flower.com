const crypto = require('node:crypto');
const { validateCheckout } = require('../../../legacy-node/backend/orders/validation');
const base = { customerName: 'Khách 🌹', phone: '0901234567', address: 'Đường Hoa', deliveryDate: '2027-01-01', deliveryTime: '08:00–11:00',
  deliveryZoneId: 'zone-a', paymentMethod: 'qr', idempotencyKey: '12345678-1234-4123-8123-123456789abc',
  expectedTotals: { subtotal: 100000, savings: 0, tax: 0, shippingFee: 25000, total: 125000 }, items: [{ id: 'rose', quantity: '1' }] };
const fingerprints = ['', 'Giao "Hoa"\\\n\u001b\u2028🌹', ' Chúc mừng – Việt Nam '].map(note => {
  const body = { ...base, orderNote: note };
  return { body, expected: crypto.createHash('sha256').update(JSON.stringify({ ...validateCheckout(body), orderNote: note.trim(), uid: 'user-a' })).digest('hex') };
});
const raw = ['{"b":1,"2":"two","1":"one","a":"Hoa 🌹"}', '{"x":1,"x":2}', '{"x":"\\uD800"}',
  '[1e-7,1e-6,1e20,1e21,9007199254740991,-0]', '{"x":"\\u001B\\b\\f\\n\\r\\t\\\\\\\"/"}']
  .map(input => ({ input, expected: JSON.stringify(JSON.parse(input)) }));
process.stdout.write(JSON.stringify({ fingerprints, raw }));
