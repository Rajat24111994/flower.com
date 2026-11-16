const test = require('node:test');
const assert = require('node:assert/strict');
const { isStrongPassword } = require('../flower.com/js/core/password-policy');
const { createLocalAccounts } = require('../flower.com/lib/local-accounts');

test('new passwords require 8–4096 characters, lowercase and a number', () => {
    for (const value of [null, 12345678, '', 'abc1234', 'abcdefgh', '12345678', 'ABCDEF12', 'a1' + 'x'.repeat(4095)]) {
        assert.equal(isStrongPassword(value), false, String(value).slice(0, 20));
    }
    for (const value of ['abcdef12', 'Abcdef12!', 'a1' + 'x'.repeat(4094)]) assert.equal(isStrongPassword(value), true);
});

test('local register and reset reject weak passwords on the server', t => {
    const accounts = createLocalAccounts({ filename: ':memory:' });
    t.after(() => accounts.close());
    for (const password of ['abc1234', 'abcdefgh', '12345678']) {
        assert.throws(() => accounts.register({ email: 'policy@demo', password }), { code: 'invalid-password' });
        assert.throws(() => accounts.reset({ email: 'policy@demo', newPassword: password }), { code: 'invalid-password' });
    }
});
