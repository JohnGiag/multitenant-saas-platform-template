import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import type { RateLimitResult, WeightedRateLimiter } from '../domain/ports/rate-limiter.port.js';

// GCRA: one number per bucket, the time at which the budget is whole again. Every unit spent moves it windowMs / limit
// later, and a request fits while that stays within one window from now. So a caller may spend `limit` units at once,
// and they come back evenly over the window. Constant memory and time whatever the cost, unlike the sliding window's
// one entry per request. Atomic: Redis runs the whole script without interleaving.
// KEYS[1] = bucket, ARGV = limit, window ms, cost. Returns { allowed (1/0), remaining, resetSeconds }.
const GCRA_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
-- A request larger than the whole budget spends all of it, instead of never fitting.
local cost = math.min(tonumber(ARGV[3]), limit)

-- Use the Redis clock, not the caller's, so app instances with skewed clocks agree.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local wholeAt = math.max(tonumber(redis.call('GET', key)) or now, now)
-- How much of the window the budget would be in use for with this request let in.
local usedMs = wholeAt - now + cost * windowMs / limit

local allowed = 0
local resetMs
if usedMs <= windowMs then
  allowed = 1
  redis.call('SET', key, string.format('%.3f', now + usedMs), 'PX', math.ceil(usedMs))
  resetMs = usedMs
else
  -- Refused requests spend nothing.
  resetMs = usedMs - windowMs
  usedMs = wholeAt - now
end

return { allowed, math.floor((windowMs - usedMs) * limit / windowMs), math.ceil(resetMs / 1000) }
`;

type RedisWithGcra = Redis & {
  gcra(key: string, limit: number, windowMs: number, cost: number): Promise<[number, number, number]>;
};

@Injectable()
export class RedisWeightedRateLimiter implements WeightedRateLimiter {
  private readonly redis: RedisWithGcra;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    redis.defineCommand('gcra', { numberOfKeys: 1, lua: GCRA_LUA });
    this.redis = redis as RedisWithGcra;
  }

  async consume(key: string, limit: number, windowMs: number, cost: number): Promise<RateLimitResult> {
    const [allowed, remaining, resetSec] = await this.redis.gcra(key, limit, windowMs, cost);
    return { allowed: allowed === 1, remaining, resetSec };
  }
}
