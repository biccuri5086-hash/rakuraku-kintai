const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
};

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const rec = store.get(key);
  if (!rec || rec.resetAt < now) {
    return { allowed: true, remaining: MAX_ATTEMPTS, resetInSec: 0 };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0, resetInSec: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - rec.count, resetInSec: 0 };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const rec = store.get(key);
  if (!rec || rec.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

export function recordSuccess(key: string): void {
  store.delete(key);
}
