// Passwords and session tokens.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
// N=2^15, r=8, p=1 needs 32 MiB, so allow a little more than that.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEY_LENGTH, params, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Stored as `scrypt$N$r$p$saltB64$hashB64` so parameters can be raised later. */
export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to verify against when the username doesn't exist, so timing doesn't reveal it. */
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
  return false;
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// ---------- Validation ----------

export const USERNAME_RULES = 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function validateUsername(value) {
  if (typeof value !== 'string') return USERNAME_RULES;
  const name = value.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) return USERNAME_RULES;
  return null;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  if (value.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  return null;
}

export const usernameKey = (name) => name.trim().toLowerCase();
