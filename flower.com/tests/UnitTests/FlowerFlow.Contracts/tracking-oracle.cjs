const { loadModule } = require('../helpers/api-fixture');
const tracking = loadModule('flower.com/legacy-node/backend/orders/tracking.js', {
  'firebase-admin/firestore': {}, '../shared/firebase-admin': {}, '../shared/request-identity': {}
});
const stamp = { _seconds: 1763200000, _nanoseconds: 999500000,
  toDate() { return new Date(this._seconds * 1000 + Math.round(this._nanoseconds / 1e6)); } };
const base = { phone: '0901234567', address: 'Private address', customerName: 'Private name', orderNote: 'Private note',
  status: 'Chờ xác nhận', total: 100000, wrappingFee: 5000, paymentReference: 'FF123', createdAt: stamp,
  reservationExpiresAt: stamp, trackingHistory: [{ status: 'Chờ xác nhận', location: 'Private location', updatedAt: stamp }] };
process.stdout.write(JSON.stringify(['qr', 'vnpay', 'cod'].flatMap(paymentMethod =>
  [{}, { paymentVerified: true }, { paymentRefunded: true }, { status: 'Đã hủy' }].flatMap(overrides => {
    const data = { ...base, paymentMethod, ...overrides };
    return [{ type: 'public', data, expected: tracking.publicTrackingOrder('order-a', data) },
      { type: 'account', data, expected: tracking.accountTrackingOrder('order-a', data) }];
  }))));
