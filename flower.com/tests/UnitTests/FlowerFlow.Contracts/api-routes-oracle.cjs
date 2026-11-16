const { loadModule, response } = require('../helpers/api-fixture');
const { withRoutes } = loadModule('flower.com/legacy-node/backend/shared/api-routes.js', {
  './firebase-admin': { sendError: (res, status, code, error) => res.status(status).json({ code, error }) }
});
(async () => {
  const results = [];
  for (const query of [{}, { route: 'audit' }, { route: 'bouquet-wrapping' }, { route: '' },
    { route: 'unknown' }, { route: 'Audit' }, { route: ['audit', 'audit'] }, { route: '__proto__' }]) {
    const res = response();
    const handler = name => async (_req, res) => res.json({ handler: name });
    await withRoutes(handler('default'), { audit: handler('audit'), 'bouquet-wrapping': handler('bouquet-wrapping') })({ query }, res);
    results.push({ query, expected: { status: res.statusCode, body: res.body, cache: res.headers['Cache-Control'] ?? null } });
  }
  process.stdout.write(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
