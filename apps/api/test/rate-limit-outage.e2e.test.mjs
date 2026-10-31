// Runs in its own process: points the app at a Redis that does not exist.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SignJWT } from 'jose';
import { generateApiKey, hashApiKeySecret } from '../dist/modules/auth/domain/api-key.js';
import { cleanup, db, PASSWORD, seedTenant, startApp } from './helpers.mjs';

let app, call, tenantId, apiKey, adminKey;

before(async () => {
  tenantId = await seedTenant('rl-outage-e2e', { a: 'User' });
  // Login is fail-closed during the outage, so authenticate with API keys inserted directly.
  const addKey = async (role) => {
    const key = generateApiKey();
    await db.apiKey.create({
      data: { tenantId, name: 'outage', role, prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) },
    });
    return key.raw;
  };
  apiKey = await addKey('User');
  adminKey = await addKey('TenantAdmin');
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  ({ app, call } = await startApp());
});

after(() => cleanup(app, [tenantId]));

test('authenticated requests fail open: served, but unmetered', async () => {
  const res = await call('GET', '/auth/me', { apiKey });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-ratelimit-limit'), null);
});

test('a write that publishes an event answers, audited, though its webhook cannot be queued', async () => {
  const endpoint = await db.webhookEndpoint.create({
    data: { tenantId, url: 'https://example.com/hook', events: [], encryptedSecret: new Uint8Array(40) },
  });
  const res = await call('POST', '/api-keys', { apiKey: adminKey, body: { name: 'during-outage' } });
  assert.equal(res.status, 201);
  assert.equal(await db.auditLog.count({ where: { tenantId, route: '/v1/api-keys' } }), 1);
  await db.webhookEndpoint.delete({ where: { id: endpoint.id } });
});

test('a notification that cannot be queued answers 503', async () => {
  const integration = await call('PUT', '/integrations/resend', { apiKey: adminKey, body: { config: { apiKey: 're_x', from: 'a@example.com' } } });
  assert.equal(integration.status, 200);
  const { id: userId } = await db.user.findFirstOrThrow({ where: { tenantId } });
  const res = await call('POST', '/notifications', { apiKey: adminKey, body: { userId, title: 'Hi', body: 'There' } });
  assert.equal(res.status, 503);
});

test('the revocation check fails open too: a valid access token still works', async () => {
  const user = await db.user.findFirstOrThrow({ where: { tenantId } });
  const token = await new SignJWT({ tid: tenantId, sid: crypto.randomUUID(), at: Date.now(), role: user.role, tier: 'free' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('enterprise-api-starter')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  assert.equal((await call('GET', '/auth/me', { token })).status, 200);
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
