import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import type { RateLimiter, RateLimitResult } from '../domain/ports/rate-limiter.port.js';

// Sliding window over a sorted set (score = request time), ported from nestjs-redis-rate-limiter.
// Atomic: Redis runs the whole script without interleaving.
// KEYS[1] = bucket, ARGV = limit, window ms, unique member. Returns { allowed (1/0), remaining, resetSeconds }.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local member = ARGV[3]

-- Use the Redis clock, not the caller's, so app instances with skewed clocks agree.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)

local count = redis.call('ZCARD', key)
local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

redis.call('PEXPIRE', key, windowMs)

-- A slot frees up when the oldest entry leaves the window.
local resetMs = windowMs
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if oldest[2] then
  resetMs = tonumber(oldest[2]) + windowMs - now
end

-- max(): after a limit is lowered, a window can hold more entries than the new limit.
return { allowed, math.max(limit - count, 0), math.ceil(resetMs / 1000) }
`;

type RedisWithSlidingWindow = Redis & {
  slidingWindow(key: string, limit: number, windowMs: number, member: string): Promise<[number, number, number]>;
};

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  private readonly redis: RedisWithSlidingWindow;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    // defineCommand sends EVALSHA and falls back to EVAL on NOSCRIPT (after SCRIPT FLUSH, a restart or a failover).
    redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });
    this.redis = redis as RedisWithSlidingWindow;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const [allowed, remaining, resetSec] = await this.redis.slidingWindow(key, limit, windowMs, randomUUID());
    return { allowed: allowed === 1, remaining, resetSec };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
