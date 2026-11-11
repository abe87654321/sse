import { createHash, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';

export const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72;

export function isBcryptHash(value: string): boolean {
  return typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
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
  if (!stored) {
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

  // Legacy rows may still contain plaintext passwords. Compare without leaking
  // length/timing, and ask the caller to opportunistically replace the value.
  const ok = constantTimeEqual(password, stored);
  return { ok, needsRehash: ok };
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少${MIN_PASSWORD_LENGTH}位`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `密码长度不能超过${MAX_PASSWORD_LENGTH}位`;
  }
  return null;
}
