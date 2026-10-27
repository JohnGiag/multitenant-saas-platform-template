import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { LOGIN_ACCOUNT_LIMIT } from '../dist/modules/rate-limit/domain/rate-limit-policy.js';
import { cleanup, db, PASSWORD, seedTenant, startApp } from './helpers.mjs';

const NEW_PASSWORD = 'a brand new passphrase';
const tenants = {};
const tokens = {};
let app, call, login;

before(async () => {
  tenants.platform = await seedTenant('users-e2e-platform', { super: 'SuperAdmin', padmin: 'TenantAdmin' });
  tenants.a = await seedTenant('users-e2e-a', { admin: 'TenantAdmin', auditor: 'Auditor', user: 'User' });
  tenants.b = await seedTenant('users-e2e-b', { admin: 'TenantAdmin', bob: 'User' });
  tenants.solo = await seedTenant('users-e2e-solo', { solo: 'TenantAdmin', member: 'User' });
  tenants.pair = await seedTenant('users-e2e-pair', { a1: 'TenantAdmin', a2: 'TenantAdmin' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.padmin = await login(tenants.platform, 'padmin@example.com');
  tokens.admin = await login(tenants.a, 'admin@example.com');
  tokens.auditor = await login(tenants.a, 'auditor@example.com');
  tokens.user = await login(tenants.a, 'user@example.com');
  tokens.solo = await login(tenants.solo, 'solo@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const idOf = async (tenantId, local) =>
  (await db.user.findFirstOrThrow({ where: { tenantId, email: `${local}@example.com` } })).id;
test('nobody creates a user with a password chosen for them: members join by invitation', async () => {
  const res = await call('POST', '/users', { token: tokens.admin, body: { email: 'x@example.com', password: PASSWORD } });
  assert.equal(res.status, 404);
});

test('auditors read the list; users and auditors cannot manage members', async () => {
  const user = await idOf(tenants.a, 'user');
  assert.equal((await call('GET', '/users', { token: tokens.auditor })).status, 200);
  assert.equal((await call('PATCH', `/users/${user}`, { token: tokens.auditor, body: { role: 'Auditor' } })).status, 403);
  assert.equal((await call('GET', '/users', { token: tokens.user })).status, 403);
  assert.equal((await call('DELETE', `/users/${user}`, { token: tokens.user })).status, 403);
});

test('the list pages through this tenant’s users only', async () => {
  const seen = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ limit: '2', ...(cursor && { cursor }) });
    const page = await (await call('GET', `/users?${qs}`, { token: tokens.admin })).json();
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const expected = await db.user.findMany({ where: { tenantId: tenants.a }, orderBy: { id: 'asc' } });
  assert.deepEqual(seen.map((u) => u.id), expected.map((u) => u.id));
  assert.ok(seen.every((u) => u.tenantId === tenants.a && !('passwordHash' in u)));
});

test('another tenant’s users are not found, and stay untouched', async () => {
  const bob = await idOf(tenants.b, 'bob');
  assert.equal((await call('PATCH', `/users/${bob}`, { token: tokens.admin, body: { role: 'Auditor' } })).status, 404);
  assert.equal((await call('DELETE', `/users/${bob}`, { token: tokens.admin })).status, 404);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: bob } })).role, 'User');
});

test('roles change, members are removed, and the last TenantAdmin stays', async () => {
  const solo = await idOf(tenants.solo, 'solo');
  const member = await idOf(tenants.solo, 'member');
  const patch = (id, role) => call('PATCH', `/users/${id}`, { token: tokens.solo, body: { role } });

  assert.equal((await patch(solo, 'User')).status, 409);
  assert.equal((await call('DELETE', `/users/${solo}`, { token: tokens.solo })).status, 409);
  assert.equal((await patch(member, 'SuperAdmin')).status, 400);

  const promoted = await patch(member, 'Auditor');
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).role, 'Auditor');

  assert.equal((await call('DELETE', `/users/${member}`, { token: tokens.solo })).status, 204);
  assert.equal(await login(tenants.solo, 'member@example.com'), 401);
  assert.equal((await call('DELETE', `/users/${member}`, { token: tokens.solo })).status, 404);
});

test('a demotion racing another admin change waits for it, so one TenantAdmin always remains', async () => {
  const [a1, a2] = [await idOf(tenants.pair, 'a1'), await idOf(tenants.pair, 'a2')];
  const t2 = await login(tenants.pair, 'a2@example.com');
  let request;
  // A concurrent change holds the admin-row lock: it demotes a2 while the API demotes a1.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE tenant_id = ${tenants.pair}::uuid AND role = 'TenantAdmin' FOR UPDATE`;
    request = call('PATCH', `/users/${a1}`, { token: t2, body: { role: 'User' } });
    await sleep(300);
    await tx.user.update({ where: { id: a2 }, data: { role: 'User' } });
  });
  // The API waited for that change, saw a1 was now the last admin, and refused.
  assert.equal((await request).status, 409);
  assert.equal(await db.user.count({ where: { tenantId: tenants.pair, role: 'TenantAdmin' } }), 1);
});

test('a SuperAdmin manages users of any tenant, but SuperAdmin accounts are off limits', async () => {
  const asSuperInB = { token: tokens.super, tenant: tenants.b };
  const listed = await (await call('GET', '/users', asSuperInB)).json();
  assert.ok(listed.items.length > 0 && listed.items.every((u) => u.tenantId === tenants.b));
  const bob = await idOf(tenants.b, 'bob');
  const promoted = await call('PATCH', `/users/${bob}`, { ...asSuperInB, body: { role: 'Auditor' } });
  assert.equal((await promoted.json()).role, 'Auditor');

  const superId = await idOf(tenants.platform, 'super');
  assert.equal((await call('PATCH', `/users/${superId}`, { token: tokens.padmin, body: { role: 'User' } })).status, 403);
  assert.equal((await call('DELETE', `/users/${superId}`, { token: tokens.padmin })).status, 403);
});

test('everyone changes their own password; wrong guesses are limited per account', async () => {
  const change = (token, currentPassword, newPassword = NEW_PASSWORD) =>
    call('PUT', '/users/me/password', { token, body: { currentPassword, newPassword } });

  assert.equal((await change(tokens.user, 'not my password')).status, 400);
  assert.equal((await change(tokens.user, PASSWORD)).status, 204);
  assert.equal(await login(tenants.a, 'user@example.com'), 401);
  assert.equal(typeof (await login(tenants.a, 'user@example.com', NEW_PASSWORD)), 'string');

  // Self-service: allowed for a read-only Auditor too.
  assert.equal((await change(tokens.auditor, PASSWORD)).status, 204);

  const { key } = await (await call('POST', '/api-keys', { token: tokens.admin, body: { name: 'k' } })).json();
  const viaKey = await call('PUT', '/users/me/password', {
    apiKey: key,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  assert.equal(viaKey.status, 403);

  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) assert.equal((await change(tokens.admin, 'guess')).status, 400);
  const blocked = await change(tokens.admin, PASSWORD);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});
