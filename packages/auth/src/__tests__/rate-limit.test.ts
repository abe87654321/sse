import { checkRateLimit, pruneRateLimitStore } from '../rate-limit';

describe('fixed-window rate limiter', () => {
  it('allows requests up to the limit and denies the next one', () => {
    const store = new Map();
    const opts = { limit: 3, windowMs: 60_000, now: 1_000 };

    expect(checkRateLimit(store, 'u1', opts).allowed).toBe(true);
    expect(checkRateLimit(store, 'u1', opts).allowed).toBe(true);
    expect(checkRateLimit(store, 'u1', opts).allowed).toBe(true);

    const denied = checkRateLimit(store, 'u1', opts);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('keeps per-key windows independent', () => {
    const store = new Map();
    const opts = { limit: 1, windowMs: 60_000, now: 1_000 };

    expect(checkRateLimit(store, 'u1', opts).allowed).toBe(true);
    expect(checkRateLimit(store, 'u1', opts).allowed).toBe(false);
    expect(checkRateLimit(store, 'u2', opts).allowed).toBe(true);
  });

  it('resets after the window elapses', () => {
    const store = new Map();
    expect(checkRateLimit(store, 'u1', { limit: 1, windowMs: 1_000, now: 1_000 }).allowed).toBe(true);
    expect(checkRateLimit(store, 'u1', { limit: 1, windowMs: 1_000, now: 1_500 }).allowed).toBe(false);
    expect(checkRateLimit(store, 'u1', { limit: 1, windowMs: 1_000, now: 2_000 }).allowed).toBe(true);
  });

  it('prunes expired windows only', () => {
    const store = new Map();
    checkRateLimit(store, 'old', { limit: 1, windowMs: 1_000, now: 1_000 });
    checkRateLimit(store, 'new', { limit: 1, windowMs: 10_000, now: 1_000 });

    pruneRateLimitStore(store, 2_500);
    expect(store.has('old')).toBe(false);
    expect(store.has('new')).toBe(true);
  });
});
