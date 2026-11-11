const fs = require('node:fs');
const path = require('node:path');
const TARGETS = ['api/delivery-zones.js', 'api/orders.js', 'api/design-requests.js',
    'js/catalog/product-store.js', 'lib/firebase-admin.js', 'js/review/review-images.js'];

function parseLcov(contents) {
    const rows = [];
    for (const record of contents.split('end_of_record')) {
        const file = record.match(/^SF:(.+)\r?$/m)?.[1]?.trim().replace(/\\/g, '/');
        if (!file) continue;
        const found = Number(record.match(/^LF:(\d+)\r?$/m)?.[1]);
        const hit = Number(record.match(/^LH:(\d+)\r?$/m)?.[1]);
        if (!Number.isSafeInteger(found) || !Number.isSafeInteger(hit) || found < 0 || hit < 0 || hit > found) {
            throw new Error(`Invalid LCOV line counters: ${file}`);
        }
        rows.push({ file, found, hit });
    }
    if (!rows.length) throw new Error('No LCOV source records found.');
    return rows;
}

// The issue accepts unit OR integration per module. Select the better individual result;
// do not sum percentages/counts across runs, which would double-count executed lines.
function checkTargets(inputs, minimum = 50, targets = TARGETS) {
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error('Minimum must be between 0 and 100.');
    const sources = inputs.flatMap(input => parseLcov(input.contents).map(row => ({ ...row, source: input.label })));
    const rows = targets.map(target => {
        const candidates = sources.filter(row => row.file === target || row.file.endsWith('/' + target))
            .filter(row => row.found > 0).map(row => ({ ...row, percent: row.hit / row.found * 100 }))
            .sort((a, b) => b.percent - a.percent);
        const best = candidates[0];
        return { target, source: best?.source || 'MISSING', hit: best?.hit || 0, found: best?.found || 0,
            percent: best?.percent ?? 0, passed: Boolean(best) && best.percent >= minimum };
    });
    return { rows, passed: rows.every(row => row.passed) };
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        const option = args.find(arg => arg.startsWith('--min-lines='));
        const minimum = option ? Number(option.slice('--min-lines='.length)) : 50;
        const files = args.filter(arg => !arg.startsWith('--'));
        if (!files.length) throw new Error('Usage: node tests/coverage-targets.js <unit.lcov> <integration.lcov> [--min-lines=50]');
        const result = checkTargets(files.map(file => ({ label: path.normalize(file), contents: fs.readFileSync(file, 'utf8') })), minimum);
        console.log('### Critical module coverage\n');
        console.log('| Module | Best test report | Lines | Required | Result |\n|---|---|---|---|---|');
        for (const row of result.rows) console.log(`| ${row.target} | ${row.source} | ${row.percent.toFixed(2)}% (${row.hit}/${row.found}) | ${minimum}% | ${row.passed ? 'PASS' : 'FAIL'} |`);
        if (!result.passed) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { TARGETS, parseLcov, checkTargets };
