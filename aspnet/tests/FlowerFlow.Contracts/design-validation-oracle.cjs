const rules = require('../../../flower.com/backend/design-requests/validation');
const crypto = require('node:crypto');
const cases = [];
function add(method, input, work) { try { cases.push({ method, input, expected: work() }); } catch { cases.push({ method, input, exception: true }); } }
for (const input of [{}, null, { paperLayers: 0 }, { paperLayers: '0' }, { paperLayers: 6 }, { budget: '100000', surprise: true },
  { budget: -1 }, { budget: 1000000001 }, { addons: ['hộp quà', 'hộp quà'] }, { addons: [['hộp quà']] },
  { addons: ['hộp quà', ['hộp quà']] }, { addons: ['invalid'] }, { wrapStyle: 'Không gói' }, { paperColor: 'TRẮNG' },
  { paperColor: 'white' }, { greetingCard: 'x'.repeat(301) }, { mainProductId: 'bad/id' }, { confirmBeforeMaking: null }])
  add('design', input, () => rules.parseDesign(input));
for (const input of [[], null, [{ productId: 'rose', quantity: '2', color: 'Hồng', role: 'main' }],
  [{ productId: 'rose', quantity: 51, color: 'hồng' }], [{ productId: 'rose', quantity: 1, color: 'pink' }],
  [{ productId: 'rose', quantity: 30, color: 'hồng' }, { productId: 'lily', quantity: 21, color: 'trắng' }],
  [{ productId: 'rose', quantity: 1, color: 'hồng' }, { productId: 'rose', quantity: 1, color: 'hồng' }]])
  add('stems', input, () => rules.normalizeStems(input));
const token = 'a'.repeat(43), hash = crypto.createHash('sha256').update(token).digest('hex');
for (const input of [{ token, hash }, { token, hash: hash + 'zz' }, { token: 'short', hash }, { token, hash: 'aa' }, { token: 'b'.repeat(43), hash }])
  add('token', input, () => rules.validAccessToken(input.token, input.hash));
for (const input of ['', null, false, 'data:image/jpeg;base64,dGV4dA==',
  'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64'),
  'data:image/webp;base64,' + Buffer.from('RIFF0000WEBP').toString('base64')]) add('image', input, () => rules.validImage(input));
process.stdout.write(JSON.stringify(cases));
