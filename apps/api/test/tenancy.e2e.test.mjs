import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cleanup, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call;

before(async () => {
  tenants.platform = await seedTenant('tenancy-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('tenancy-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('tenancy-e2e-b', { admin: 'TenantAdmin' });
  let login;
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

test('current tenant comes from the token, not from the caller', async () => {
  const { status, body } = await json(await call('GET', '/tenants/current', { token: tokens.userA }));
  assert.equal(status, 200);
  assert.equal(body.id, tenants.a);

  assert.equal((await call('GET', '/tenants/current', { token: tokens.userA, tenant: tenants.a })).status, 200);
  assert.equal((await call('GET', '/tenants/current', { token: tokens.adminA, tenant: tenants.b })).status, 403);
  assert.equal((await call('GET', '/tenants/current', { token: tokens.adminA, tenant: 'nope' })).status, 400);
});

test('SuperAdmin targets another tenant explicitly with X-Tenant-Id', async () => {
  const { body } = await json(await call('GET', '/tenants/current', { token: tokens.super, tenant: tenants.b }));
  assert.equal(body.id, tenants.b);
  const missing = await call('GET', '/tenants/current', { token: tokens.super, tenant: crypto.randomUUID() });
  assert.equal(missing.status, 404);
});

test('a tenant can rename itself but not change its tier', async () => {
  const res = await call('PATCH', '/tenants/current', {
    token: tokens.adminA,
    body: { name: 'Renamed A', tier: 'enterprise' },
  });
  const { status, body } = await json(res);
  assert.equal(status, 200);
  assert.deepEqual({ name: body.name, tier: body.tier }, { name: 'Renamed A', tier: 'free' });

  for (const token of [tokens.userA, tokens.auditorA]) {
    assert.equal((await call('PATCH', '/tenants/current', { token, body: { name: 'x' } })).status, 403);
  }
});

test('cross-tenant management is SuperAdmin only', async () => {
  assert.equal((await call('GET', '/tenants', { token: tokens.adminA })).status, 403);
  assert.equal((await call('POST', '/tenants', { token: tokens.adminA, body: { name: 'x' } })).status, 403);
  assert.equal((await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.adminA, body: { tier: 'pro' } })).status, 403);
  assert.equal((await call('DELETE', `/tenants/${tenants.b}`, { token: tokens.adminA })).status, 403);
});

test('SuperAdmin creates, lists with a cursor, updates and deletes tenants', async () => {
  const created = await json(await call('POST', '/tenants', { token: tokens.super, body: { name: 'tenancy-e2e-new' } }));
  assert.equal(created.status, 201);
  assert.equal(created.body.tier, 'free');
  tenants.created = created.body.id;

  const updated = await json(
    await call('PATCH', `/tenants/${tenants.created}`, { token: tokens.super, body: { tier: 'pro' } }),
  );
  assert.equal(updated.body.tier, 'pro');
  assert.equal((await call('PATCH', `/tenants/${tenants.created}`, { token: tokens.super, body: {} })).status, 400);
  const unknown = `/tenants/${crypto.randomUUID()}`;
  assert.equal((await call('PATCH', unknown, { token: tokens.super, body: { tier: 'pro' } })).status, 404);

  const first = await json(await call('GET', '/tenants?limit=1', { token: tokens.super }));
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.nextCursor, first.body.items[0].id);
  const second = await json(await call('GET', `/tenants?limit=1&cursor=${first.body.nextCursor}`, { token: tokens.super }));
  assert.ok(second.body.items[0].id > first.body.items[0].id, 'pages must move forward');
  assert.equal((await call('GET', '/tenants?limit=500', { token: tokens.super })).status, 400);

  // Refuses to delete a tenant that still has users.
  assert.equal((await call('DELETE', `/tenants/${tenants.a}`, { token: tokens.super })).status, 409);
  assert.equal((await call('DELETE', `/tenants/${tenants.created}`, { token: tokens.super })).status, 204);
  assert.equal((await call('DELETE', `/tenants/${tenants.created}`, { token: tokens.super })).status, 404);
});
