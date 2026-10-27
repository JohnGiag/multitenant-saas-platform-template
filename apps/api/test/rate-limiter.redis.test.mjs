// Runs the sliding-window script against the docker-compose Redis. Ported from nestjs-redis-rate-limiter.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, beforeEach, test } from 'node:test';
import { Redis } from 'ioredis';
import { RedisRateLimiter } from '../dist/modules/rate-limit/infrastructure/redis-rate-limiter.js';

if (existsSync('.env')) process.loadEnvFile();

const redis = new Redis(process.env.REDIS_URL);
const limiter = new RedisRateLimiter(redis);
let key;

beforeEach(() => {
  key = `rl:test:${crypto.randomUUID()}`;
});

after(async () => {
  await redis.quit();
});

test('counts down remaining and reports when a slot frees up', async () => {
  for (const remaining of [2, 1, 0]) {
    assert.deepEqual(await limiter.consume(key, 3, 10_000), { allowed: true, remaining, resetSec: 10 });
  }
  const denied = await limiter.consume(key, 3, 10_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.ok(denied.resetSec >= 1 && denied.resetSec <= 10);
});

test('slides: a slot frees when the oldest request leaves the window', async () => {
  // limit 2 per 1s. A fixed window would reset both slots at t=1000; a sliding one frees only A's.
  assert.equal((await limiter.consume(key, 2, 1000)).allowed, true); // A, t≈0
  await sleep(500);
  assert.equal((await limiter.consume(key, 2, 1000)).allowed, true); // B, t≈500
  assert.equal((await limiter.consume(key, 2, 1000)).allowed, false); // full
  await sleep(600);
  assert.equal((await limiter.consume(key, 2, 1000)).allowed, true); // t≈1100, A expired
  assert.equal((await limiter.consume(key, 2, 1000)).allowed, false); // B still in window
});

test('denied requests are not recorded, so memory stays at most `limit` and keys expire', async () => {
  for (let i = 0; i < 10; i++) await limiter.consume(key, 2, 10_000);
  assert.equal(await redis.zcard(key), 2);
  const ttl = await redis.pttl(key);
  assert.ok(ttl > 0 && ttl <= 10_000, `ttl ${ttl}`);
});

test('never reports negative remaining after a limit is lowered', async () => {
  for (let i = 0; i < 5; i++) await limiter.consume(key, 5, 10_000);
  assert.deepEqual(await limiter.consume(key, 3, 10_000), { allowed: false, remaining: 0, resetSec: 10 });
});

test('recovers after Redis loses its script cache (NOSCRIPT)', async () => {
  await limiter.consume(key, 5, 10_000);
  await redis.script('FLUSH');
  assert.equal((await limiter.consume(key, 5, 10_000)).remaining, 3);
});
