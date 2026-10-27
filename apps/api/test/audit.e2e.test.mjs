import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call, login;

before(async () => {
  tenants.platform = await seedTenant('audit-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('audit-e2e-a', { admin: 'TenantAdmin', user: 'User' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const auditOf = (tenantId) => db.auditLog.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });
const userId = async (tenantId, local) =>
  (await db.user.findFirstOrThrow({ where: { tenantId, email: `${local}@example.com` } })).id;

test('successful writes are recorded with the actor; reads and rejected requests are not', async () => {
  const before = (await auditOf(tenants.a)).length;
  const created = await call('POST', '/api-keys', { token: tokens.adminA, body: { name: 'ci' } });
  assert.equal(created.status, 201);
  const { id: keyId } = await created.json();
  assert.equal((await call('DELETE', `/api-keys/${keyId}`, { token: tokens.adminA })).status, 204);
  // Not recorded: a read, a 403, and a 400.
  await call('GET', '/api-keys', { token: tokens.adminA });
  assert.equal((await call('POST', '/api-keys', { token: tokens.userA, body: { name: 'x' } })).status, 403);
  assert.equal((await call('POST', '/api-keys', { token: tokens.adminA, body: {} })).status, 400);

  const rows = (await auditOf(tenants.a)).slice(before);
  const adminId = await userId(tenants.a, 'admin');
  assert.deepEqual(
    rows.map(({ actorKind, actorId, actorRole, actedOnTenantId, method, route, targetId, status }) => ({
      actorKind, actorId, actorRole, actedOnTenantId, method, route, targetId, status,
    })),
    [
      { actorKind: 'user', actorId: adminId, actorRole: 'TenantAdmin', actedOnTenantId: null, method: 'POST', route: '/v1/api-keys', targetId: null, status: 201 },
      { actorKind: 'user', actorId: adminId, actorRole: 'TenantAdmin', actedOnTenantId: null, method: 'DELETE', route: '/v1/api-keys/:id', targetId: keyId, status: 204 },
    ],
  );
});

test("a SuperAdmin's actions on a tenant are recorded in the SuperAdmin's tenant, and outlive it", async () => {
  const doomed = await seedTenant('audit-e2e-doomed', { admin: 'TenantAdmin', user: 'User' });
  const target = await userId(doomed, 'user');
  // The doomed tenant's own admin acts too: that record goes with the tenant.
  const adminToken = await login(doomed, 'admin@example.com');
  await call('POST', '/api-keys', { token: adminToken, body: { name: 'k' } });
  assert.equal((await auditOf(doomed)).length, 1);

  const patched = await call('PATCH', `/users/${target}`, { token: tokens.super, tenant: doomed, body: { role: 'Auditor' } });
  assert.equal(patched.status, 200);
  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);

  const superId = await userId(tenants.platform, 'super');
  const rows = (await auditOf(tenants.platform)).filter((r) => r.actorId === superId);
  assert.deepEqual(
    rows.slice(-2).map(({ actorRole, actedOnTenantId, method, route, targetId }) => ({ actorRole, actedOnTenantId, method, route, targetId })),
    [
      { actorRole: 'SuperAdmin', actedOnTenantId: doomed, method: 'PATCH', route: '/v1/users/:id', targetId: target },
      { actorRole: 'SuperAdmin', actedOnTenantId: null, method: 'DELETE', route: '/v1/tenants/:id', targetId: doomed },
    ],
  );
  assert.equal((await auditOf(doomed)).length, 0);
});
