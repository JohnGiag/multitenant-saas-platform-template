import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAccess } from '../dist/modules/auth/domain/access-policy.js';
import {
  apiKeySecretMatches,
  generateApiKey,
  hashApiKeySecret,
  parseApiKey,
} from '../dist/modules/auth/domain/api-key.js';

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

test('API keys round-trip and reject tampering', () => {
  const key = generateApiKey();
  assert.match(key.raw, /^eak_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseApiKey(key.raw), { prefix: key.prefix, secret: key.secret });

  const stored = hashApiKeySecret(key.secret);
  assert.equal(stored.length, 32);
  assert.ok(apiKeySecretMatches(key.secret, stored));
  assert.ok(!apiKeySecretMatches(generateApiKey().secret, stored));
  assert.ok(!apiKeySecretMatches(key.secret, stored.subarray(0, 16)));
});

test('malformed API keys do not parse', () => {
  const { raw } = generateApiKey();
  for (const bad of ['', 'eak_', raw.slice(0, -1), `${raw}x`, raw.replace('eak_', 'xak_'), ` ${raw}`]) {
    assert.equal(parseApiKey(bad), null, JSON.stringify(bad));
  }
});
