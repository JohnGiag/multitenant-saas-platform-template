import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { cleanup, db, FIXTURES, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call, login, syncApp, syncCall;

before(async () => {
  tenants.platform = await seedTenant('audit-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('audit-e2e-a', { admin: 'TenantAdmin', user: 'User' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  // A route marked @NotAudited() next to an ordinary one.
  ({ app: syncApp, call: syncCall } = await startApp({ optionalModulesDir: join(FIXTURES, 'optional-not-audited') }));
});

after(() => cleanup([app, syncApp], Object.values(tenants)));

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
  // The doomed tenant's own admin signs in and acts too: those records go with the tenant.
  const adminToken = await login(doomed, 'admin@example.com');
  await call('POST', '/api-keys', { token: adminToken, body: { name: 'k' } });
  assert.equal((await auditOf(doomed)).length, 2);

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

test('the audit log is readable newest first, page by page, by its own tenant only', async () => {
  tenants.reader = await seedTenant('audit-e2e-reader', { admin: 'TenantAdmin', auditor: 'Auditor', user: 'User' });
  tenants.other = await seedTenant('audit-e2e-other', { admin: 'TenantAdmin' });
  const admin = await login(tenants.reader, 'admin@example.com');
  for (const name of ['one', 'two', 'three']) await call('POST', '/api-keys', { token: admin, body: { name } });
  await call('POST', '/api-keys', { token: await login(tenants.other, 'admin@example.com'), body: { name: 'elsewhere' } });

  const read = async (token, query = '', extra) => {
    const res = await call('GET', `/audit-logs${query}`, { token, ...extra });
    return { status: res.status, body: res.ok ? await res.json() : null };
  };
  const ids = (await auditOf(tenants.reader)).map((r) => r.id).reverse();
  const page1 = await read(admin, '?limit=2');
  assert.equal(page1.status, 200);
  assert.deepEqual(page1.body.items.map((e) => e.id), ids.slice(0, 2));
  assert.deepEqual(Object.keys(page1.body.items[0]).sort(), ['actedOnTenantId', 'actorId', 'actorKind', 'actorRole', 'createdAt', 'id', 'method', 'route', 'status', 'targetId']);
  const page2 = await read(admin, `?limit=2&cursor=${page1.body.nextCursor}`);
  assert.deepEqual(page2.body.items.map((e) => e.id), ids.slice(2));
  assert.equal(page2.body.nextCursor, null);

  // Auditors read; members do not; nothing of another tenant shows up. The signing-in counts too.
  assert.equal((await read(await login(tenants.reader, 'auditor@example.com'))).body.items.length, ids.length + 1);
  assert.equal((await read(await login(tenants.reader, 'user@example.com'))).status, 403);
  const elsewhere = (await auditOf(tenants.other)).map((r) => r.id);
  assert.equal(elsewhere.length, 2);
  assert.ok((await read(admin, '?limit=100')).body.items.every((e) => !elsewhere.includes(e.id)));

  // SuperAdmin: its own platform trail, never another tenant's.
  const platform = await read(tokens.super, '?limit=100');
  assert.equal(platform.status, 200);
  assert.ok(platform.body.items.every((e) => e.actorRole === 'SuperAdmin'));
  assert.equal((await read(tokens.super, '', { tenant: tenants.reader })).status, 403);
  assert.equal((await read(admin, '?cursor=not-a-cursor')).status, 400);
});

test('the audit log filters by actor, target and time, page by page, within the tenant', async () => {
  tenants.filtered = await seedTenant('audit-e2e-filtered', { admin: 'TenantAdmin' });
  tenants.stranger = await seedTenant('audit-e2e-stranger', { admin: 'TenantAdmin' });
  const [alice, bob, doc, stranger] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const row = (tenantId, actorId, targetId, day) => ({
    tenantId, actorKind: 'user', actorId, actorRole: 'User', method: 'PATCH', route: '/v1/users/:id', targetId, status: 200,
    createdAt: new Date(`2026-10-${day}T12:00:00.000Z`),
  });
  await db.auditLog.createMany({
    data: [
      row(tenants.filtered, alice, doc, '01'),
      row(tenants.filtered, alice, null, '02'),
      row(tenants.filtered, bob, doc, '03'),
      row(tenants.filtered, alice, doc, '04'),
      row(tenants.stranger, stranger, doc, '02'),
    ],
  });
  const token = await login(tenants.filtered, 'admin@example.com');
  const read = async (query) => {
    const res = await call('GET', `/audit-logs?${new URLSearchParams(query)}`, { token });
    return { status: res.status, body: res.ok ? await res.json() : null };
  };
  const days = async (query) => (await read(query)).body.items.map((e) => e.createdAt.slice(8, 10));

  assert.deepEqual(await days({ actorId: alice }), ['04', '02', '01']);
  assert.deepEqual(await days({ targetId: doc }), ['04', '03', '01']);
  assert.deepEqual(await days({ actorId: alice, targetId: doc }), ['04', '01']);
  // `from` inclusive, `to` exclusive.
  assert.deepEqual(await days({ from: '2026-10-02T12:00:00.000Z', to: '2026-10-04T12:00:00.000Z' }), ['03', '02']);
  // Filters hold across pages.
  const page1 = await read({ actorId: alice, limit: '2' });
  assert.deepEqual(page1.body.items.map((e) => e.createdAt.slice(8, 10)), ['04', '02']);
  assert.deepEqual(await days({ actorId: alice, limit: '2', cursor: page1.body.nextCursor }), ['01']);
  // Another tenant's actor is never found.
  assert.deepEqual(await days({ actorId: stranger }), []);
  assert.equal((await read({ actorId: 'not-a-uuid' })).status, 400);
  assert.equal((await read({ from: '2026-10-01' })).status, 400);
});

test('a write marked @NotAudited() is not recorded; an ordinary one still is', async () => {
  const before = (await auditOf(tenants.a)).length;
  assert.equal((await syncCall('POST', '/sync/data', { token: tokens.adminA })).status, 201);
  assert.equal((await syncCall('POST', '/sync/change', { token: tokens.adminA })).status, 201);
  const rows = (await auditOf(tenants.a)).slice(before);
  assert.deepEqual(rows.map((r) => r.route), ['/v1/sync/change']);
});
