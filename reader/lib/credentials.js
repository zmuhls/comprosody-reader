import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const PASSWORD_HASH_PATTERN = /^\$scrypt\$N=32768,r=8,p=3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/u;

export const MIN_PASSWORD_LENGTH = 16;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_ACCOUNT_SECRET_LENGTH = 24;

export class CredentialValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'CredentialValidationError';
    this.code = 'invalid_credential';
    this.field = field;
  }
}

function passwordLength(value) {
  return typeof value === 'string' ? [...value].length : -1;
}

export function validateNewPassword(value, confirmation) {
  const length = passwordLength(value);
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new CredentialValidationError(
      'password',
      `password must contain ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  if (value !== confirmation) {
    throw new CredentialValidationError('passwordConfirmation', 'passwords do not match.');
  }
  return value;
}

export function secureStringEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left ?? ''), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export function accountSecretConfigured(value) {
  return typeof value === 'string' && [...value.trim()].length >= MIN_ACCOUNT_SECRET_LENGTH;
}

export function accountSecretDigest(value) {
  if (!accountSecretConfigured(value)) return null;
  return crypto.createHash('sha256').update(value.trim(), 'utf8').digest('base64url');
}

export function verifyAccountSecret(value, digest) {
  if (typeof digest !== 'string') return false;
  const supplied = crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest();
  const expected = Buffer.from(digest, 'base64url');
  return expected.length === supplied.length && crypto.timingSafeEqual(supplied, expected);
}

export async function hashPassword(value) {
  const length = passwordLength(value);
  if (length < 1 || length > MAX_PASSWORD_LENGTH) {
    throw new CredentialValidationError('password', 'password is outside the supported length.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(value, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export function validatePasswordHash(value) {
  if (typeof value !== 'string' || !PASSWORD_HASH_PATTERN.test(value)) {
    throw new Error('The stored credential hash is invalid.');
  }
  return value;
}

export async function verifyPassword(value, encodedHash) {
  const match = validatePasswordHash(encodedHash).match(PASSWORD_HASH_PATTERN);
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  const supported = typeof value === 'string'
    && passwordLength(value) >= 0
    && passwordLength(value) <= MAX_PASSWORD_LENGTH;
  const supplied = await scrypt(supported ? value : '\0unsupported-password-input', salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return supported && crypto.timingSafeEqual(Buffer.from(supplied), expected);
}
