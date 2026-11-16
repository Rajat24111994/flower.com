// Run the four actual shared JS modules with deterministic SDK boundaries.
const { loadModule, response } = require('../helpers/api-fixture');
const headers = [
  '', 'Basic token', 'Bearer ', 'Bearer token', 'bEaReR\ttoken', 'Bearer token extra',
  ...['\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u2007',
    '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085'].map(space => `Bearer${space}token`),
  ...['\n', '\r', '\r\n', '\u2028', '\u2029', '\n\n'].map(end => `Bearer token${end}`),
  'Bearer tok\u0085en', 'Bearer tok\ufeffen', 'Bearer token ', 'Bearer revoked'
];

(async () => {
  const authentication = [];
  for (const method of ['request', 'identity']) {
    for (const authorization of headers) {
      let verifiedToken = null, checkRevoked = null;
      const auth = { async verifyIdToken(token, revoked) {
        verifiedToken = token; checkRevoked = revoked;
        if (token === 'revoked') throw Object.assign(new Error('fixture-failure'), { code: 'auth/fixture-failure' });
        return { uid: 'firebase-user' };
      } };
      const shared = loadModule('flower.com/legacy-node/backend/shared/firebase-admin.js', {
        'firebase-admin/app': {}, 'firebase-admin/auth': {}, 'firebase-admin/firestore': {}
      });
      const identity = loadModule('flower.com/legacy-node/backend/shared/request-identity.js', { './firebase-admin': { getAdminAuth: () => auth } });
      const res = response(); let user = null, error = null;
      try {
        user = method === 'request' ? await shared.verifyRequest({ headers: { authorization } }, res, auth)
          : await identity.optionalCustomer({ headers: { authorization } });
      } catch (failure) { error = failure.code; }
      authentication.push({ method, authorization, expected: { uid: user?.uid ?? null, error,
        status: res.statusCode, body: res.body ?? null, verifiedToken, checkRevoked } });
    }
  }
  const local = [];
  for (const account of [null, { uid: 'local-user' }]) for (const presented of [false, true])
    for (const authorization of ['', 'Bearer token', 'Basic token']) {
      const identity = loadModule('flower.com/legacy-node/backend/shared/request-identity.js');
      const req = { headers: { authorization }, [identity.LOCAL_IDENTITY]: { account, presented } };
      let user = null, error = null;
      try { user = await identity.optionalCustomer(req); } catch (failure) { error = failure.code; }
      local.push({ account, presented, authorization, expected: { uid: user?.uid ?? null, error } });
    }
  const audit = [];
  const auditApi = loadModule('flower.com/legacy-node/backend/shared/admin-audit.js', {
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'server-timestamp' } }
  });
  for (const email of [null, false, true, 0, 42, '', 'owner@example.test', ['owner', 'test'], { address: 'owner' }, 'e'.repeat(321)]) {
    for (const details of [undefined, null, { before: 1, after: 2 }]) {
      let entry;
      const reference = { async create(data) { entry = data; } };
      const db = { collection(name) { if (name !== 'adminAudit') throw new Error('Wrong collection'); return { doc: () => reference }; } };
      const actor = { uid: 'u'.repeat(129), email };
      const args = [db, actor, 'a'.repeat(81), 'r'.repeat(81), 'i'.repeat(129)];
      if (details !== undefined) args.push(details);
      if (await auditApi.recordAdminAudit(...args) !== reference) throw new Error('Wrong audit reference');
      audit.push({ actor, ...(details === undefined ? {} : { details }), expected: entry });
    }
  }
  const { withRoutes } = loadModule('flower.com/legacy-node/backend/shared/api-routes.js', {
    './firebase-admin': { sendError: (res, status, code, error) => res.status(status).json({ code, error }) }
  });
  const routes = [];
  for (const route of [undefined, '', 'audit', 'Audit', 'constructor', '__proto__', 'toString', ['audit', 'audit']]) {
    const query = route === undefined ? {} : { route };
    const res = response();
    const named = name => async (_req, result) => result.json({ handler: name });
    await withRoutes(named('default'), { audit: named('audit') })({ query }, res);
    routes.push({ query, expected: { status: res.statusCode, body: res.body, cache: res.headers['Cache-Control'] ?? null } });
  }
  process.stdout.write(JSON.stringify({ authentication, local, audit, routes }));
})().catch(error => { console.error(error); process.exitCode = 1; });
