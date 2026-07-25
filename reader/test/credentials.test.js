import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountSecretDigest,
  hashPassword,
  secureStringEqual,
  validateNewPassword,
  validatePasswordHash,
  verifyAccountSecret,
  verifyPassword,
} from '../lib/credentials.js';

test('password hashes are salted, self-describing, and verifiable', async () => {
  const password = 'a sufficiently long test password';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(validatePasswordHash(first), first);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('a different long test password', first), false);
  assert.equal(await verifyPassword(null, first), false);
  assert.equal(await verifyPassword('x'.repeat(129), first), false);
  assert.match(first, /^\$scrypt\$N=32768,r=8,p=3\$/u);
});

test('new password validation preserves unicode and rejects mismatches or unsafe lengths', () => {
  const password = 'correct battery 🔒 phrase';
  assert.equal(validateNewPassword(password, password), password);
  assert.throws(
    () => validateNewPassword('too short', 'too short'),
    (error) => error?.field === 'password',
  );
  assert.throws(
    () => validateNewPassword(password, `${password}!`),
    (error) => error?.field === 'passwordConfirmation',
  );
});

test('account codes are compared through fixed-length digests', () => {
  const secret = 'a-long-random-looking-account-code';
  const digest = accountSecretDigest(secret);
  assert.equal(typeof digest, 'string');
  assert.equal(verifyAccountSecret(secret, digest), true);
  assert.equal(verifyAccountSecret('wrong-code', digest), false);
  assert.equal(accountSecretDigest('short'), null);
  assert.equal(secureStringEqual('same', 'same'), true);
  assert.equal(secureStringEqual('same', 'different-length'), false);
});
