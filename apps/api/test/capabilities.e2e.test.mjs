import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { CapabilityResponseSchema } from '@repo/shared-types';
import { loadOptionalModules } from '../dist/modules/system/infrastructure/optional-module-loader.js';
import { cleanup, FIXTURES, OPTIONAL_FIXTURES, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call;

before(async () => {
  tenants.a = await seedTenant('caps-e2e-a', { admin: 'TenantAdmin', user: 'User' });
  tenants.b = await seedTenant('caps-e2e-b', { admin: 'TenantAdmin' });
  let login;
  ({ app, call, login } = await startApp({ optionalModulesDir: OPTIONAL_FIXTURES }));
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

async function capabilities(token) {
  const res = await call('GET', '/system/capabilities', { token });
  assert.equal(res.status, 200);
  const body = await res.json();
  // Parsing strips unknown fields, so equality also rejects anything the shared schema lacks.
  assert.deepEqual(CapabilityResponseSchema.parse(body), body, 'response does not match shared schema');
  return body.capabilities;
}

const storageEnabled = async (token) => (await capabilities(token)).find((c) => c.key === 'storage').enabled;

test('lists installed optional modules, enabled per tenant configuration', async () => {
  assert.deepEqual(await capabilities(tokens.userA), [
    { key: 'email', integration: 'resend', enabled: false },
    { key: 'push', integration: 'fcm', enabled: false },
    { key: 'storage', integration: 'r2', enabled: false },
    { key: 'webhooks', integration: null, enabled: true },
  ]);

  assert.equal((await call('PUT', '/integrations/r2', { token: tokens.adminA, body: { config: { accessKeyId: 'x' } } })).status, 200);
  assert.equal(await storageEnabled(tokens.userA), true);
  // Tenant B has not configured r2.
  assert.equal(await storageEnabled(tokens.adminB), false);

  await call('PUT', '/integrations/r2', { token: tokens.adminA, body: { config: { accessKeyId: 'x' }, enabled: false } });
  assert.equal(await storageEnabled(tokens.userA), false);
});

test('requires authentication', async () => {
  assert.equal((await call('GET', '/system/capabilities')).status, 401);
});

test('a missing optional folder means nothing is installed', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'no-optional-'));
  try {
    assert.deepEqual(await loadOptionalModules(empty), []);
    assert.deepEqual(await loadOptionalModules(join(empty, 'missing')), []);
  } finally {
    rmSync(empty, { recursive: true });
  }
});

test('a broken optional module stops startup instead of vanishing', async () => {
  await assert.rejects(loadOptionalModules(join(FIXTURES, 'optional-broken')), /Optional module "bad"/);
  await assert.rejects(
    loadOptionalModules(join(FIXTURES, 'optional-missing-index')),
    /Optional module "email" has no index\.js/,
  );
  await assert.rejects(
    loadOptionalModules(join(FIXTURES, 'optional-duplicate')),
    /Optional module key "dup" is declared twice/,
  );
});
