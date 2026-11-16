const validation = require('../../../flower.com/backend/orders/validation');
const base = { customerName: ' Khách hàng ', phone: '+84 901 234 567', address: ' 1 đường Hoa ',
  deliveryDate: '2027-01-01', deliveryTime: '08:00–11:00', deliveryZoneId: 'zone-a', paymentMethod: 'qr',
  idempotencyKey: '12345678-1234-4123-8123-123456789abc',
  expectedTotals: { subtotal: 100000, savings: 0, tax: 0, shippingFee: 0, total: 100000 }, items: [{ id: '1', quantity: 2 }] };
const results = [];
function add(type, body) { results.push({ type, body, expected: validation[type === 'checkout' ? 'validateCheckout' : 'validateQuote'](body) }); }
add('checkout', base); add('checkout', { ...base, customerIsRecipient: true, recipientName: 'Ignored', recipientPhone: '0' });
for (const [key, values] of Object.entries({ customerName: ['', 'a'.repeat(101), 123], phone: ['123', '0'.repeat(16)],
  recipientName: ['a'.repeat(121), ' '], greetingCard: ['a'.repeat(300), 'a'.repeat(301)],
  deliveryDate: ['2026-02-29', '2028-02-29', '0000-02-29', '2027-13-01'], deliveryTime: ['08:00-11:00'],
  paymentMethod: ['cod', 'vnpay', 'cash'], giftWrap: ['classic', 'pastel', 'x'], deliveryZoneId: ['', 'a/b'],
  idempotencyKey: ['12345678-1234-5123-8123-123456789abc'], expectedTotals: [null, { ...base.expectedTotals, wrappingFee: null },
    { ...base.expectedTotals, total: '100000' }, { ...base.expectedTotals, wrappingFee: 0 }] }))
  for (const value of values) add('checkout', { ...base, [key]: value });
for (const quantity of [null, false, true, [], [2], {}, '2', '0x10', '1e1', -1, 0, 1, 50, 51, 1.5]) {
  add('quote', { items: [{ id: '1', quantity }] }); add('checkout', { ...base, items: [{ id: '1', quantity }] });
}
for (const items of [[], [{ id: '1', quantity: 1 }, { id: '1', quantity: 2 }], [{ id: 'a/b', quantity: 1 }],
  [{ id: '1', quantity: 1, size: 'large', color: 'pink', cardMessage: ' Chúc mừng ', customBouquetId: 'bouquet-1' }],
  [{ id: '1', quantity: 1, size: 'wrong' }], [{ id: 9007199254740991, quantity: 1 }]]) add('quote', { items });
process.stdout.write(JSON.stringify({ results, schedules: ['2026-11-14', '2026-11-15', '2026-11-16', '2026-02-29'].flatMap(date =>
  ['08:00–11:00', '14:00–17:00', '17:00–20:00', 'bad'].flatMap(time => ['2026-11-15T06:59:00Z', '2026-11-15T08:00:00Z']
    .map(now => ({ date, time, now, expected: validation.deliveryScheduleError(date, time, new Date(now)) })))) }));
