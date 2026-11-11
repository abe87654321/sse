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

  it('rejects legacy plaintext by default', async () => {
    delete process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
    await expect(verifyPassword('legacy-secret', 'legacy-secret')).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('accepts legacy plaintext only when explicitly enabled and asks for a rehash', async () => {
    const previous = process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
    process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = '1';
    try {
      await expect(verifyPassword('legacy-secret', 'legacy-secret')).resolves.toEqual({
        ok: true,
        needsRehash: true,
      });
      await expect(verifyPassword('other-secret', 'legacy-secret')).resolves.toEqual({
        ok: false,
        needsRehash: false,
      });
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
      else process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = previous;
    }
  });

  it('rejects known provisioning sentinels even when legacy plaintext is enabled', async () => {
    const previous = process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
    process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = '1';
    try {
      for (const sentinel of ['scim_managed_no_pwd', 'mdm_managed_no_pwd', '!', '   ']) {
        await expect(verifyPassword(sentinel, sentinel)).resolves.toEqual({
          ok: false,
          needsRehash: false,
        });
      }
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
      else process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = previous;
    }
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

  it('enforces the 6 character minimum and 72 UTF-8 byte maximum', () => {
    expect(validatePassword('a'.repeat(6))).toBeNull();
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(5))).toContain('至少6位');
    expect(validatePassword('a'.repeat(73))).toContain('不能超过72位');
  });

  it('counts multibyte characters by UTF-8 byte length', () => {
    // 24 Chinese characters = 72 UTF-8 bytes: allowed.
    expect(validatePassword('密'.repeat(24))).toBeNull();
    // 25 Chinese characters = 75 UTF-8 bytes: rejected even though it is only
    // 25 characters long.
    expect(validatePassword('密'.repeat(25))).toContain('不能超过72位');
  });

  it('clamps the configured bcrypt cost to the supported 10-14 range', () => {
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(10);
    expect(BCRYPT_ROUNDS).toBeLessThanOrEqual(14);
  });

  it('recognises the supported bcrypt prefixes', () => {
    expect(isBcryptHash('$2a$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2y$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2x$10$abcdefghijklmnopqrstuv')).toBe(false);
    expect(isBcryptHash('not-a-hash')).toBe(false);
  });
});
