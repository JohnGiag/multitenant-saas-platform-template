export const RATE_LIMITER = Symbol('RateLimiter');

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  // Seconds until a slot frees up.
  resetSec: number;
}

export interface RateLimiter {
  // Counts one request against `key`; throws when the store (Redis) is unreachable.
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  // Empties the bucket, e.g. after a successful login.
  reset(key: string): Promise<void>;
}
