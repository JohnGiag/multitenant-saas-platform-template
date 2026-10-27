import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { decodeKeysetCursor, keysetArgs, keysetCursorSchema, keysetPage } from '../dist/common/keyset.js';
import { applyTrustProxy } from '../dist/common/trust-proxy.js';
import { parseSentinels } from '../dist/infrastructure/redis/sentinels.js';
import {
  loginAccountKey,
  loginEmailKey,
  passwordResetKey,
  PUBLIC_LIMIT,
  planRateLimit,
  TIER_LIMITS,
} from '../dist/modules/rate-limit/domain/rate-limit-policy.js';

const client = { ip: '10.0.0.1', method: 'GET', route: '/v1/auth/me' };
const principal = (tier, kind = 'user') => ({ kind, id: 'p1', tenantId: 't1', role: 'User', tier });

test('authenticated callers: one bucket per tenant and caller, limit by tier, fail open', () => {
  for (const tier of ['free', 'pro', 'enterprise']) {
    assert.deepEqual(planRateLimit(principal(tier), client), {
      key: 'rl:t1:user:p1',
      limit: TIER_LIMITS[tier],
      windowMs: 60_000,
      failOpen: true,
    });
  }
  assert.ok(TIER_LIMITS.free < TIER_LIMITS.pro && TIER_LIMITS.pro < TIER_LIMITS.enterprise);
  assert.equal(planRateLimit(principal('free', 'apiKey'), client).key, 'rl:t1:apiKey:p1');
});

test('public routes: one bucket per IP and route, HEAD shares GET, fail closed', () => {
  const login = { ip: '10.0.0.1', method: 'POST', route: '/v1/auth/login' };
  assert.deepEqual(planRateLimit(null, login), {
    key: 'rl:ip:10.0.0.1:POST:/v1/auth/login',
    limit: PUBLIC_LIMIT,
    windowMs: 60_000,
    failOpen: false,
  });
  assert.equal(planRateLimit(null, { ...client, method: 'HEAD' }).key, planRateLimit(null, client).key);
});

test('login account key is per tenant and email, and never holds the email itself', () => {
  const key = loginAccountKey('t1', 'ada@example.com');
  assert.equal(key, loginAccountKey('t1', 'ada@example.com'));
  assert.notEqual(key, loginAccountKey('t2', 'ada@example.com'));
  assert.notEqual(key, loginAccountKey('t1', 'bob@example.com'));
  assert.match(key, /^rl:login:t1:[0-9a-f]{64}$/);
});

test('email-only login and reset keys are per email across tenants, and never hold the email itself', () => {
  assert.equal(loginEmailKey('ada@example.com'), loginEmailKey('ada@example.com'));
  assert.notEqual(loginEmailKey('ada@example.com'), loginEmailKey('bob@example.com'));
  assert.match(loginEmailKey('ada@example.com'), /^rl:login-email:[0-9a-f]{64}$/);
  assert.match(passwordResetKey('ada@example.com'), /^rl:reset:[0-9a-f]{64}$/);
});

const encode = (tuple) => Buffer.from(JSON.stringify(tuple)).toString('base64url');

test('keyset cursor round-trips and rejects garbage or a value of the wrong type', () => {
  const id = crypto.randomUUID();
  const at = '2026-10-27T10:00:00.000Z';
  const page = keysetPage([{ id: crypto.randomUUID(), at: 'x' }, { id, at }, { id: 'extra' }], 2, (r) => r.at);
  assert.deepEqual(keysetCursorSchema(z.iso.datetime()).parse(page.nextCursor), { value: at, id });
  assert.deepEqual(decodeKeysetCursor(encode([7, id]), z.number()), { value: 7, id });
  assert.equal(keysetPage([{ id }], 2, () => 'x').nextCursor, null);

  const bad = [
    'not base64 json',
    encode({ a: 1 }),
    encode([at, 'not-a-uuid']),
    // Well-formed, but not a timestamp: must be a 400, not reach the database.
    encode(['not-a-date', id]),
    encode([5, id]),
  ];
  for (const cursor of bad) {
    assert.equal(keysetCursorSchema(z.iso.datetime()).safeParse(cursor).success, false, cursor);
  }
});

test('keyset args seek past the cursor with an id tie-break', () => {
  assert.deepEqual(keysetArgs('createdAt', 'desc'), { where: {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  assert.deepEqual(keysetArgs('createdAt', 'desc', { value: 'T', id: 'I' }).where, {
    AND: [{ createdAt: { lte: 'T' } }, { OR: [{ createdAt: { lt: 'T' } }, { id: { lt: 'I' } }] }],
  });
  assert.deepEqual(keysetArgs('name', 'asc', { value: 'n', id: 'I' }).where, {
    AND: [{ name: { gte: 'n' } }, { OR: [{ name: { gt: 'n' } }, { id: { gt: 'I' } }] }],
  });
});

test('trust proxy accepts only a hop count', () => {
  const set = [];
  applyTrustProxy({ set: (...args) => set.push(args) }, '2');
  assert.deepEqual(set, [['trust proxy', 2]]);
  for (const bad of ['', 'true', '-1', '1.5', '10.0.0.1']) {
    assert.throws(() => applyTrustProxy({ set() {} }, bad), /TRUST_PROXY_HOPS/, bad);
  }
});

test('sentinel list parsing', () => {
  assert.deepEqual(parseSentinels('a:26379, b:26380'), [
    { host: 'a', port: 26379 },
    { host: 'b', port: 26380 },
  ]);
  for (const bad of ['a', 'a:0', 'a:70000', 'a:1:2', ':26379']) {
    assert.throws(() => parseSentinels(bad), /REDIS_SENTINELS/, bad);
  }
});
