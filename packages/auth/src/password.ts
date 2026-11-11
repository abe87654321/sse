import { createHash, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';

const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_BYTES = 72;

// Values written by external identity provisioning (SCIM/MDM) must never act as
// a login credential, even when legacy plaintext comparison is temporarily on.
const PASSWORD_SENTINELS = new Set(['scim_managed_no_pwd', 'mdm_managed_no_pwd', '!']);

function readBcryptRounds(): number {
  const parsed = Number(process.env.BCRYPT_ROUNDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(14, Math.max(10, Math.floor(parsed)));
}

export const BCRYPT_ROUNDS = readBcryptRounds();

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

const DUMMY_PASSWORD = 'sse-dummy-password-for-timing';
let dummyHashCache: string | null = null;

export function isBcryptHash(value: string): boolean {
  return typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * A bcrypt hash at the active cost, used to spend comparable time when an
 * account does not exist. The value itself is never a valid user password.
 */
export function dummyPasswordHash(): string {
  if (!dummyHashCache) {
    dummyHashCache = bcrypt.hashSync(DUMMY_PASSWORD, BCRYPT_ROUNDS);
  }
  return dummyHashCache;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = sha256(a);
  const right = sha256(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!stored || stored.trim() === '' || PASSWORD_SENTINELS.has(stored)) {
    return { ok: false, needsRehash: false };
  }

  if (isBcryptHash(stored)) {
    try {
      const ok = await bcrypt.compare(password, stored);
      if (!ok) return { ok: false, needsRehash: false };
      const cost = bcrypt.getRounds(stored);
      return { ok: true, needsRehash: cost < BCRYPT_ROUNDS };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  // Legacy rows may still contain plaintext passwords. Only allow comparison
  // when the operator explicitly opts in for a migration window.
  if (process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS !== '1') {
    return { ok: false, needsRehash: false };
  }

  // Compare without leaking length/timing, and ask the caller to replace the
  // value after a successful login.
  const ok = constantTimeEqual(password, stored);
  return { ok, needsRehash: ok };
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少${MIN_PASSWORD_LENGTH}位`;
  }
  // bcrypt truncates at 72 UTF-8 bytes, so a longer password would silently
  // share a prefix without this byte-level check.
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `密码长度不能超过${MAX_PASSWORD_BYTES}位（UTF-8 字节）`;
  }
  return null;
}
