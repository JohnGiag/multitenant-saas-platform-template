import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { decideRefresh, parseRefreshToken, signRefreshToken } from '../dist/modules/auth/domain/refresh-token.js';
import { decideAccess, METHOD_SCOPE } from '../dist/modules/auth/domain/access-policy.js';
import {
  apiKeySecretMatches,
  generateApiKey,
  hashApiKeySecret,
  parseApiKey,
} from '../dist/modules/auth/domain/api-key.js';
import { verifyWebhookSignature } from '../dist/modules/auth/domain/webhook-signature.js';

test('webhook signatures (Svix): right key, exact body, fresh timestamp', () => {
  const key = Buffer.from('a webhook secret of some length');
  const secret = `whsec_${key.toString('base64')}`;
  const body = '{"type":"user.deleted","data":{"id":"user_1"}}';
  const now = 1_800_000_000;
  const sign = (id, timestamp, payload, k = key) =>
    `v1,${createHmac('sha256', k).update(`${id}.${timestamp}.${payload}`).digest('base64')}`;
  const check = (overrides = {}) =>
    verifyWebhookSignature({ secret, id: 'msg_1', timestamp: String(now), signatures: sign('msg_1', now, body), body, nowSeconds: now, ...overrides });

  assert.equal(check(), true);
  assert.equal(check({ body: Buffer.from(body) }), true, 'raw bytes');
  // Several signatures (secret rotation): any valid one is enough.
  assert.equal(check({ signatures: `v1,bm9wZQ== ${sign('msg_1', now, body)}` }), true);

  assert.equal(check({ body: body.replace('user_1', 'user_2') }), false, 'tampered body');
  assert.equal(check({ id: 'msg_2' }), false, 'id is signed');
  assert.equal(check({ signatures: sign('msg_1', now, body, Buffer.from('another key')) }), false, 'wrong key');
  assert.equal(check({ signatures: sign('msg_1', now, body).replace('v1,', 'v2,') }), false, 'unknown version');
  assert.equal(check({ signatures: '' }), false);
  assert.equal(check({ nowSeconds: now + 301 }), false, 'too old: replay');
  assert.equal(check({ nowSeconds: now - 301 }), false, 'from the future');
  assert.equal(check({ timestamp: 'soon' }), false);
});

const as = (role) => ({ kind: 'user', id: crypto.randomUUID(), tenantId: crypto.randomUUID(), role });

test('access policy denies by default', () => {
  assert.equal(decideAccess(null, ['User'], 'GET'), 'unauthenticated');
  assert.equal(decideAccess(as('TenantAdmin'), undefined, 'GET'), 'forbidden');
  assert.equal(decideAccess(as('TenantAdmin'), [], 'GET'), 'forbidden');
  assert.equal(decideAccess(as('User'), ['TenantAdmin'], 'GET'), 'forbidden');
  assert.equal(decideAccess(as('TenantAdmin'), ['TenantAdmin'], 'POST'), 'allow');
});

test('SuperAdmin is not implied by any other role', () => {
  assert.equal(decideAccess(as('SuperAdmin'), ['TenantAdmin', 'User'], 'GET'), 'forbidden');
  assert.equal(decideAccess(as('SuperAdmin'), ['SuperAdmin'], 'DELETE'), 'allow');
});

test('Auditor is read-only even when listed', () => {
  assert.equal(decideAccess(as('Auditor'), ['Auditor'], 'GET'), 'allow');
  assert.equal(decideAccess(as('Auditor'), ['Auditor'], 'head'), 'allow');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(decideAccess(as('Auditor'), ['Auditor'], method), 'forbidden');
  }
});

test('self-service routes let an Auditor change its own account, nothing else', () => {
  assert.equal(decideAccess(as('Auditor'), ['Auditor'], 'PUT', true), 'allow');
  // Still only for listed roles.
  assert.equal(decideAccess(as('Auditor'), ['User'], 'PUT', true), 'forbidden');
});

test('an API key needs the scope of its route, on top of its role', () => {
  const key = (scopes, role = 'TenantAdmin') => ({ ...as(role), kind: 'apiKey', scopes });
  const allowed = ['TenantAdmin'];
  assert.equal(decideAccess(key(['read', 'write']), allowed, 'GET'), 'forbidden', 'a route with no scope is closed to keys');
  assert.equal(decideAccess(as('TenantAdmin'), allowed, 'GET'), 'allow', 'and only to keys');

  assert.equal(decideAccess(key(['read']), allowed, 'GET', false, METHOD_SCOPE), 'allow');
  assert.equal(decideAccess(key(['read']), allowed, 'POST', false, METHOD_SCOPE), 'forbidden');
  assert.equal(decideAccess(key(['write']), allowed, 'POST', false, METHOD_SCOPE), 'allow');
  assert.equal(decideAccess(key(['write']), allowed, 'GET', false, METHOD_SCOPE), 'forbidden');

  assert.equal(decideAccess(key(['ingest']), allowed, 'POST', false, 'ingest'), 'allow');
  assert.equal(decideAccess(key(['read', 'write']), allowed, 'POST', false, 'ingest'), 'forbidden');
  assert.equal(decideAccess(key(['ingest'], 'User'), allowed, 'POST', false, 'ingest'), 'forbidden', 'a scope never widens the role');
  assert.equal(decideAccess(key(['write'], 'Auditor'), ['Auditor'], 'POST', false, METHOD_SCOPE), 'forbidden', 'an Auditor stays read-only');
});

test('API keys round-trip and reject tampering', () => {
  const key = generateApiKey();
  assert.match(key.raw, /^sk_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseApiKey(key.raw), { mode: 'live', prefix: key.prefix, secret: key.secret });
  assert.equal(parseApiKey(generateApiKey('test').raw).mode, 'test');

  const stored = hashApiKeySecret(key.secret);
  assert.equal(stored.length, 32);
  assert.ok(apiKeySecretMatches(key.secret, stored));
  assert.ok(!apiKeySecretMatches(generateApiKey().secret, stored));
  assert.ok(!apiKeySecretMatches(key.secret, stored.subarray(0, 16)));
});

test('malformed API keys do not parse', () => {
  const { raw } = generateApiKey();
  for (const bad of ['', 'sk_live_', raw.slice(0, -1), `${raw}x`, raw.replace('sk_live_', 'sk_prod_'), ` ${raw}`]) {
    assert.equal(parseApiKey(bad), null, JSON.stringify(bad));
  }
});

test('refresh tokens: derived from the session, and any change to one is refused', () => {
  const key = new TextEncoder().encode('k'.repeat(48));
  const claims = { tenantId: crypto.randomUUID(), sessionId: crypto.randomUUID(), generation: 3 };
  const token = signRefreshToken(key, claims);
  assert.equal(token, signRefreshToken(key, claims), 'the same session and generation give the same token');
  assert.deepEqual(parseRefreshToken(key, token), claims);
  assert.equal(parseRefreshToken(new TextEncoder().encode('o'.repeat(48)), token), null, 'another key');
  assert.equal(parseRefreshToken(key, token.replace('.3.', '.4.')), null, 'another generation');
  assert.equal(parseRefreshToken(key, token.replace(claims.tenantId, crypto.randomUUID())), null, 'another tenant');
  assert.equal(parseRefreshToken(key, 'garbage'), null);
});

test('rotation: the current token rotates, the last one repeats for a moment, anything else is a replay', () => {
  const now = new Date(1_800_000_000_000);
  const rotated = (ms) => ({ generation: 5, rotatedAt: new Date(now.getTime() - ms) });
  assert.equal(decideRefresh({ generation: 0, rotatedAt: null }, 0, now), 'rotate');
  assert.equal(decideRefresh(rotated(1000), 5, now), 'rotate');
  assert.equal(decideRefresh(rotated(30_000), 4, now), 'repeat');
  assert.equal(decideRefresh(rotated(30_001), 4, now), 'reuse');
  assert.equal(decideRefresh(rotated(1000), 3, now), 'reuse');
  assert.equal(decideRefresh(rotated(1000), 6, now), 'reuse', 'a generation that never existed');
});
