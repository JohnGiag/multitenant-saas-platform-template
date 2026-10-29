// Runs in its own process: points the app at a Redis that does not exist.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateApiKey, hashApiKeySecret } from '../dist/modules/auth/domain/api-key.js';
import { cleanup, db, PASSWORD, seedTenant, startApp } from './helpers.mjs';

let app, call, tenantId, apiKey;

before(async () => {
  tenantId = await seedTenant('rl-outage-e2e', { a: 'User' });
  // Login is fail-closed during the outage, so authenticate with an API key inserted directly.
  const key = generateApiKey();
  await db.apiKey.create({
    data: { tenantId, name: 'outage', prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) },
  });
  apiKey = key.raw;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  ({ app, call } = await startApp());
});

after(() => cleanup(app, [tenantId]));

test('authenticated requests fail open: served, but unmetered', async () => {
  const res = await call('GET', '/auth/me', { apiKey });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-ratelimit-limit'), null);
});

test('public routes fail closed: login answers 503', async () => {
  const res = await call('POST', '/auth/login', { body: { tenantId, email: 'a@example.com', password: PASSWORD } });
  assert.equal(res.status, 503);
});

test('health probes fail open: liveness answers, readiness says Redis is down', async () => {
  assert.equal((await call('GET', '/health')).status, 200);
  const ready = await call('GET', '/health/ready');
  assert.equal(ready.status, 503);
  assert.match((await ready.json()).message, /^Not ready: redis$/);
});
