export const RATE_LIMITER = Symbol('RateLimiter');
export const WEIGHTED_RATE_LIMITER = Symbol('WeightedRateLimiter');

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  // Seconds until a slot frees up. From a weighted limiter: until the refused units fit, or the budget is whole again.
  resetSec: number;
}

export interface RateLimiter {
  // Counts one request against `key`; throws when the store (Redis) is unreachable.
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  // Empties the bucket, e.g. after a successful login.
  reset(key: string): Promise<void>;
}

// For routes whose requests differ in size (@RateLimitBudget): a batch of 500 spends 500.
export interface WeightedRateLimiter {
  // Counts `cost` units against `key`, all or none of them; throws when the store (Redis) is unreachable.
  consume(key: string, limit: number, windowMs: number, cost: number): Promise<RateLimitResult>;
}
