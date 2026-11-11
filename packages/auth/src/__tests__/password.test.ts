import * as bcrypt from 'bcrypt';
import {
  BCRYPT_ROUNDS,
  hashPassword,
  isBcryptHash,
  validatePassword,
  verifyPassword,
} from '../password';

describe('password helpers', () => {
  it('hashes a password as a bcrypt hash and verifies it', async () => {
    const hash = await hashPassword('correct-horse');
    expect(isBcryptHash(hash)).toBe(true);
    await expect(verifyPassword('correct-horse', hash)).resolves.toEqual({
      ok: true,
      needsRehash: false,
    });
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    await expect(verifyPassword('wrong-horse', hash)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('accepts legacy plaintext and asks for a rehash', async () => {
    await expect(verifyPassword('legacy-secret', 'legacy-secret')).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
    await expect(verifyPassword('other-secret', 'legacy-secret')).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('returns no match for an empty or missing hash', async () => {
    await expect(verifyPassword('secret', '')).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
    await expect(verifyPassword('secret', undefined as unknown as string)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('asks for a rehash when the stored bcrypt cost is below the current rounds', async () => {
    const lowerCost = BCRYPT_ROUNDS > 4 ? 4 : BCRYPT_ROUNDS;
    if (lowerCost >= BCRYPT_ROUNDS) return;
    const hash = await bcrypt.hash('low-cost-secret', lowerCost);
    await expect(verifyPassword('low-cost-secret', hash)).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it('enforces the 6 to 72 character limit', () => {
    expect(validatePassword('a'.repeat(6))).toBeNull();
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(5))).toContain('至少6位');
    expect(validatePassword('a'.repeat(73))).toContain('不能超过72位');
  });

  it('recognises the supported bcrypt prefixes', () => {
    expect(isBcryptHash('$2a$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2y$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2x$10$abcdefghijklmnopqrstuv')).toBe(false);
    expect(isBcryptHash('not-a-hash')).toBe(false);
  });
});
