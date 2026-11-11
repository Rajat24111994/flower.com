const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLcov, checkTargets } = require('./coverage-targets');
const lcov = (file, hit, found = 100) => `SF:${file}\nLF:${found}\nLH:${hit}\nend_of_record\n`;

test('coverage gate accepts either unit or integration at the exact threshold', () => {
    const result = checkTargets([
        { label: 'unit', contents: lcov('C:\\repo\\flower.com\\api\\orders.js', 30) },
        { label: 'integration', contents: lcov('../flower.com/api/orders.js', 50) }
    ], 50, ['api/orders.js']);
    assert.equal(result.passed, true); assert.equal(result.rows[0].source, 'integration');
});
test('coverage gate never adds coverage across reports or treats missing modules as passing', () => {
    const inputs = [{ label: 'unit', contents: lcov('api/orders.js', 30) },
        { label: 'integration', contents: lcov('api/orders.js', 40) }];
    assert.equal(checkTargets(inputs, 50, ['api/orders.js']).passed, false);
    assert.equal(checkTargets(inputs, 0, ['api/missing.js']).passed, false);
    assert.equal(checkTargets([{ label: 'empty-lines', contents: lcov('api/orders.js', 0, 0) }], 0, ['api/orders.js']).passed, false);
});
test('coverage parser rejects broken counters and handles Windows line endings', () => {
    assert.equal(parseLcov(lcov('api/orders.js', 50).replace(/\n/g, '\r\n'))[0].hit, 50);
    for (const contents of ['', 'SF:api/orders.js\nend_of_record\n', lcov('api/orders.js', 101)]) {
        assert.throws(() => parseLcov(contents));
    }
    assert.throws(() => checkTargets([], NaN));
    assert.throws(() => checkTargets([], -1));
});
