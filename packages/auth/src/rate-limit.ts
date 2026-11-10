export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitWindow {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter. The store is passed in explicitly so the caller
 * controls its lifetime (one process-wide store in MCP) and tests stay isolated.
 */
export function checkRateLimit(
  store: Map<string, RateLimitWindow>,
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = options.now ?? Date.now();
  const windowMs = Math.max(1, options.windowMs);
  const limit = Math.max(1, options.limit);

  const state = store.get(key);
  if (!state || now >= state.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (state.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: state.resetAt };
  }

  state.count += 1;
  return { allowed: true, remaining: limit - state.count, resetAt: state.resetAt };
}

export function pruneRateLimitStore(
  store: Map<string, RateLimitWindow>,
  now = Date.now(),
): void {
  for (const [key, state] of store) {
    if (now >= state.resetAt) store.delete(key);
  }
}
