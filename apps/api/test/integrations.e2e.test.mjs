import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { INTEGRATION_SERVICE } from '../dist/modules/integrations/domain/ports/integration.service.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const SECRET = 're_live_1234567890abcdef';
const tenants = {};
const tokens = {};
let app, call, secrets;

before(async () => {
  tenants.platform = await seedTenant('byok-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('byok-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('byok-e2e-b', { admin: 'TenantAdmin' });
  let login;
  ({ app, call, login } = await startApp());
  secrets = app.get(INTEGRATION_SERVICE);
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const put = (token, provider, body) => call('PUT', `/integrations/${provider}`, { token, body });

test('secrets are encrypted at rest and only masked values come back', async () => {
  const res = await put(tokens.adminA, 'resend', { config: { apiKey: SECRET, from: 'no-reply' } });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(SECRET) && !text.includes('no-reply'), 'plaintext in response');
  assert.deepEqual(JSON.parse(text).maskedConfig, { apiKey: '****cdef', from: '****' });

  const listed = await (await call('GET', '/integrations', { token: tokens.adminA })).text();
  assert.ok(!listed.includes(SECRET) && !listed.includes('encrypted'), 'secret or ciphertext in list');

  const row = await db.tenantIntegration.findUniqueOrThrow({
    where: { tenantId_provider: { tenantId: tenants.a, provider: 'resend' } },
  });
  assert.equal(row.encryptedConfig[0], 1);
  assert.ok(!Buffer.from(row.encryptedConfig).toString('latin1').includes(SECRET), 'secret stored in clear');

  assert.deepEqual(await secrets.getSecrets(tenants.a, 'resend'), { apiKey: SECRET, from: 'no-reply' });
});

test('integrations are isolated per tenant', async () => {
  const listB = await (await call('GET', '/integrations', { token: tokens.adminB })).json();
  assert.deepEqual(listB.items, []);
  assert.equal((await call('DELETE', '/integrations/resend', { token: tokens.adminB })).status, 404);
  assert.equal(await secrets.getSecrets(tenants.b, 'resend'), null);
  assert.ok(await secrets.getSecrets(tenants.a, 'resend'), "tenant B removed tenant A's secret");

  // A ciphertext copied into another tenant's row does not decrypt there.
  await put(tokens.adminB, 'resend', { config: { apiKey: 'b-key' } });
  const rowA = await db.tenantIntegration.findUniqueOrThrow({
    where: { tenantId_provider: { tenantId: tenants.a, provider: 'resend' } },
  });
  await db.tenantIntegration.update({
    where: { tenantId_provider: { tenantId: tenants.b, provider: 'resend' } },
    data: { encryptedConfig: rowA.encryptedConfig },
  });
  await assert.rejects(secrets.getSecrets(tenants.b, 'resend'));
});

test('roles: admins write, auditors read, users see nothing; SuperAdmin via X-Tenant-Id', async () => {
  assert.equal((await call('GET', '/integrations', { token: tokens.userA })).status, 403);
  assert.equal((await put(tokens.userA, 'r2', { config: { k: 'v' } })).status, 403);
  assert.equal((await call('GET', '/integrations', { token: tokens.auditorA })).status, 200);
  assert.equal((await put(tokens.auditorA, 'r2', { config: { k: 'v' } })).status, 403);

  const viaSuper = await call('GET', '/integrations', { token: tokens.super, tenant: tenants.a });
  assert.deepEqual((await viaSuper.json()).items.map((i) => i.provider), ['resend']);
});

test('list pages by provider', async () => {
  await put(tokens.adminA, 'r2', { config: { accessKeyId: 'x' } });
  await put(tokens.adminA, 'fcm', { config: { serviceAccount: '{}' } });
  const first = await (await call('GET', '/integrations?limit=2', { token: tokens.adminA })).json();
  assert.deepEqual(first.items.map((i) => i.provider), ['fcm', 'r2']);
  assert.equal(first.nextCursor, 'r2');
  const second = await (await call('GET', '/integrations?limit=2&cursor=r2', { token: tokens.adminA })).json();
  assert.deepEqual(second.items.map((i) => i.provider), ['resend']);
  assert.equal(second.nextCursor, null);
});

test('validation, disabling and removal', async () => {
  assert.equal((await put(tokens.adminA, 'Bad%20Name', { config: { k: 'v' } })).status, 400);
  assert.equal((await put(tokens.adminA, 'resend', { config: {} })).status, 400);

  await put(tokens.adminA, 'r2', { config: { accessKeyId: 'x' }, enabled: false });
  assert.equal(await secrets.getSecrets(tenants.a, 'r2'), null);

  assert.equal((await call('DELETE', '/integrations/resend', { token: tokens.adminA })).status, 204);
  assert.equal(await secrets.getSecrets(tenants.a, 'resend'), null);
  assert.equal((await call('DELETE', '/integrations/resend', { token: tokens.adminA })).status, 404);
});
