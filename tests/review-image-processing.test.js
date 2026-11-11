const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(t, { corrupt = false, widths = [2600, 1400], sizes = [200000, 200000, 200000, 200000, 200000, 1000] } = {}) {
    const { preparePhotos } = await import('../flower.com/js/review/review-images.js');
    const revoked = [], canvases = [], qualities = [];
    t.mock.method(URL, 'createObjectURL', () => 'blob:fixture');
    t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    const previousImage = globalThis.Image, previousDocument = globalThis.document;
    globalThis.Image = class { naturalWidth = widths[0]; naturalHeight = widths[1]; async decode() { if (corrupt) throw new Error('bad image'); } };
    globalThis.document = { createElement(type) {
        assert.equal(type, 'canvas');
        const canvas = { width: 0, height: 0, draws: 0,
            getContext: () => ({ fillRect() {}, drawImage() { canvas.draws++; } }),
            toDataURL(type, quality) { assert.equal(type, 'image/jpeg'); qualities.push(quality);
                return 'data:image/jpeg;base64,' + 'A'.repeat(sizes.shift() ?? 1000); } };
        canvases.push(canvas); return canvas;
    } };
    t.after(() => { if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
        if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
    return { preparePhotos, revoked, canvases, qualities };
}
test('review photos are resized, recompressed and their blob URLs always released', async t => {
    const f = await fixture(t);
    const result = await f.preparePhotos([{ type: 'image/png', size: 1000 }]);
    assert.equal(result.length, 1);
    assert.ok((result[0].length - 23) * 3 / 4 <= 120 * 1024);
    assert.ok(f.qualities.length > 4, 'large output must retry compression and then dimensions');
    assert.ok(f.canvases[0].width < 1280); assert.ok(f.canvases[0].draws > 1);
    assert.deepEqual(f.revoked, ['blob:fixture']);
});
test('small photos are not upscaled and empty selection needs no canvas', async t => {
    const f = await fixture(t, { widths: [100, 50], sizes: [1000] });
    assert.deepEqual(await f.preparePhotos([]), []);
    assert.equal(f.canvases.length, 0);
    await f.preparePhotos([{ type: 'image/webp', size: 10 }]);
    assert.equal(f.canvases[0].width, 100); assert.equal(f.canvases[0].height, 50);
});
test('corrupt and unsupported uploads fail without retaining object URLs', async t => {
    const f = await fixture(t, { corrupt: true });
    await assert.rejects(f.preparePhotos([{ type: 'image/jpeg', size: 100 }]), /JPG/);
    assert.deepEqual(f.revoked, ['blob:fixture']);
    await assert.rejects(f.preparePhotos([{ type: 'image/svg+xml', size: 100 }]));
    await assert.rejects(f.preparePhotos([{ type: 'image/png', size: 0 }]));
    await assert.rejects(f.preparePhotos(Array(4).fill({ type: 'image/jpeg', size: 1 })));
    assert.equal(f.revoked.length, 1);
});
