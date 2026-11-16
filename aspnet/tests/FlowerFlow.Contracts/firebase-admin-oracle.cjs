// Execute the actual legacy module with deterministic SDK boundaries, without Firebase access.
const path = require('node:path');
const { loadModule, response } = require(path.resolve(__dirname, '../../../tests/helpers/api-fixture'));
const cases = [
  { name: 'missing bearer' },
  { name: 'wrong scheme', authorization: 'Basic token' },
  { name: 'empty bearer', authorization: 'Bearer ' },
  { name: 'valid customer' },
  { name: 'case insensitive bearer', authorization: 'bEaReR\ttoken' },
  { name: 'revoked token', tokenError: true },
  { name: 'admin claim missing', method: 'admin' },
  { name: 'admin string rejected', method: 'admin', admin: 'true' },
  { name: 'admin numeric rejected', method: 'admin', admin: 1 },
  { name: 'admin false rejected', method: 'admin', admin: false },
  { name: 'admin live role required', method: 'admin', admin: true },
  { name: 'admin live document sufficient', method: 'admin', admin: true, roleExists: true },
  { name: 'admin with admin role', method: 'admin', admin: true, roleExists: true, role: 'admin' },
  { name: 'admin role read outage', method: 'admin', admin: true, roleError: true },
  { name: 'owner claim missing', method: 'owner', admin: true, roleExists: true, role: 'owner' },
  { name: 'owner claim wrong', method: 'owner', admin: true, claimRole: 'admin', roleExists: true, role: 'owner' },
  { name: 'owner document absent', method: 'owner', admin: true, claimRole: 'owner' },
  { name: 'owner document role missing', method: 'owner', admin: true, claimRole: 'owner', roleExists: true },
  { name: 'owner document mismatch', method: 'owner', admin: true, claimRole: 'owner', roleExists: true, role: 'admin' },
  { name: 'valid owner', method: 'owner', admin: true, claimRole: 'owner', roleExists: true, role: 'owner' },
  { name: 'owner without admin', method: 'owner', claimRole: 'owner', roleExists: true, role: 'owner' },
  { name: 'owner role read outage', method: 'owner', admin: true, claimRole: 'owner', roleError: true },
  { name: 'admin revoked token', method: 'admin', admin: true, tokenError: true },
  { name: 'owner revoked token', method: 'owner', admin: true, claimRole: 'owner', tokenError: true }
];
(async () => {
  const results = [];
  for (const input of cases) {
    const method = input.method || 'request';
    const authorization = input.name === 'missing bearer' ? '' : input.authorization ?? 'Bearer token';
    const claims = { uid: 'user-a', ...(input.admin === undefined ? {} : { admin: input.admin }),
      ...(input.claimRole === undefined ? {} : { role: input.claimRole }) };
    let verifiedToken = null, checkRevoked = null, roleReads = 0;
    const auth = { async verifyIdToken(token, revoked) {
      verifiedToken = token; checkRevoked = revoked;
      if (input.tokenError) throw new Error('sensitive-provider-detail');
      return claims;
    } };
    const db = { collection(name) {
      if (name !== 'adminRoles') throw new Error('Wrong collection');
      return { doc(uid) {
        if (uid !== 'user-a') throw new Error('Wrong UID');
        return { async get() { roleReads++;
          if (input.roleError) throw new Error('sensitive-provider-detail');
          return { exists: !!input.roleExists, data: () => ({ role: input.role }) };
        } };
      } };
    } };
    const api = loadModule('flower.com/backend/shared/firebase-admin.js', {
      'firebase-admin/app': {}, 'firebase-admin/auth': {}, 'firebase-admin/firestore': {}
    });
    const res = response();
    const fn = method === 'owner' ? api.verifyOwnerRequest : method === 'admin' ? api.verifyAdminRequest : api.verifyRequest;
    const identity = await fn({ headers: { authorization } }, res, auth, db);
    results.push({ ...input, method, authorization, claims,
      expected: { uid: identity?.uid ?? null, status: res.statusCode, body: res.body ?? null,
        verifiedToken, checkRevoked, roleReads } });
  }
  process.stdout.write(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
