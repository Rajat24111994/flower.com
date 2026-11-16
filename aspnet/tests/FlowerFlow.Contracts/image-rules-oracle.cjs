const fs = require('node:fs');
const path = require('node:path');
const rules = require('../../../flower.com/backend/catalog/image-rules');
const jpeg = fs.readFileSync(path.resolve(__dirname, '../../../flower.com/images/start.jpeg'));
const uri = bytes => 'data:image/jpeg;base64,' + bytes.toString('base64');
function header(width, height, marker = 0xc0) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, marker, 0, 8, 8, 0, 0, 0, 0, 0, 0xff, 0xd9]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes;
}
const inputs = [undefined, null, {}, [], [uri(jpeg)], [uri(jpeg), uri(jpeg), uri(jpeg)],
  [uri(jpeg), uri(jpeg), uri(jpeg), uri(jpeg)], [1], ['https://example.com/image.jpg'],
  ['data:image/svg+xml;base64,PHN2Zz4='], ['data:image/jpeg;base64,dGV4dA=='],
  [uri(Buffer.alloc(rules.MAX_PHOTO_BYTES + 1))], [uri(header(1600, 1600))],
  [uri(header(1601, 1))], [uri(header(0, 1))], [uri(header(1, 0))],
  [uri(header(1, 1, 0xc1))], [uri(header(1, 1, 0xc2))], [uri(header(1, 1, 0xc3))],
  ['data:image/jpeg;base64,/9j/2Q'], ['data:image/jpeg;base64,AB==']];
process.stdout.write(JSON.stringify(inputs.map(input => ({
  ...(input === undefined ? {} : { input }),
  expected: rules.validateReviewPhotos(input)?.map(bytes => bytes.toString('base64')) ?? null
}))));
