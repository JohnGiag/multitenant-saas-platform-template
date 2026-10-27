import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SignJWT } from 'jose';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
let app, base, call, login;

before(async () => {
  for (const name of ['a', 'b']) {
    tenants[name] = await seedTenant(`auth-e2e-${name}`, { admin: 'TenantAdmin', user: 'User' });
  }
  await db.user.create({ data: { tenantId: tenants.a, email: 'only-a@example.com' } });
  ({ app, base, call, login } = await startApp());
});

after(() => cleanup(app, Object.values(tenants)));

test('login issues a token whose principal comes from the server', async () => {
  const token = await login(tenants.a, 'ADMIN@example.com');
  assert.equal(typeof token, 'string');
  const res = await call('GET', '/auth/me', { token });
  assert.equal(res.status, 200);
  const lowercase = await fetch(`${base}/auth/me`, { headers: { authorization: `bearer ${token}` } });
  assert.equal(lowercase.status, 200);
  const me = await res.json();
  assert.deepEqual({ kind: me.kind, tenantId: me.tenantId, role: me.role }, {
    kind: 'user',
    tenantId: tenants.a,
    role: 'TenantAdmin',
  });
});

test('login rejects wrong password, unknown email, other tenant and bad input', async () => {
  assert.equal(await login(tenants.a, 'admin@example.com', 'wrong password'), 401);
  assert.equal(await login(tenants.a, 'nobody@example.com'), 401);
  assert.equal(await login(tenants.b, 'only-a@example.com'), 401);
  // A user without a password (external provider) cannot log in locally.
  assert.equal(await login(tenants.a, 'only-a@example.com'), 401);
  const res = await call('POST', '/auth/login', { body: { tenantId: 'not-a-uuid', email: 'x' } });
  assert.equal(res.status, 400);
});

test('protected routes reject missing, garbage and forged tokens', async () => {
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: 'garbage' })).status, 401);
  const forged = await new SignJWT({ tid: tenants.a, role: 'SuperAdmin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(crypto.randomUUID())
    .setIssuer('enterprise-api-starter')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('x'.repeat(48)));
  assert.equal((await call('GET', '/auth/me', { token: forged })).status, 401);
});

test('API keys: role-gated, tenant-isolated, revocable', async () => {
  const adminA = await login(tenants.a, 'admin@example.com');
  const adminB = await login(tenants.b, 'admin@example.com');
  const userA = await login(tenants.a, 'user@example.com');

  assert.equal((await call('POST', '/api-keys', { token: userA, body: { name: 'x' } })).status, 403);
  const superKey = await call('POST', '/api-keys', { token: adminA, body: { name: 'x', role: 'SuperAdmin' } });
  assert.equal(superKey.status, 400);

  const created = await call('POST', '/api-keys', { token: adminA, body: { name: 'ci' } });
  assert.equal(created.status, 201);
  const { id, key } = await created.json();

  const me = await (await call('GET', '/auth/me', { apiKey: key })).json();
  assert.deepEqual({ kind: me.kind, id: me.id, tenantId: me.tenantId, role: me.role }, {
    kind: 'apiKey',
    id,
    tenantId: tenants.a,
    role: 'User',
  });
  assert.equal((await call('POST', '/api-keys', { apiKey: key, body: { name: 'y' } })).status, 403);

  const row = await db.apiKey.findUniqueOrThrow({ where: { id } });
  assert.ok(!Buffer.from(row.secretHash).toString().includes(key.split('_').pop()), 'secret stored in clear');

  // Tenant B cannot revoke tenant A's key.
  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminB })).status, 404);
  assert.equal((await call('GET', '/auth/me', { apiKey: key })).status, 200);

  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminA })).status, 204);
  assert.equal((await call('GET', '/auth/me', { apiKey: key })).status, 401);
  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminA })).status, 404);
  assert.equal((await call('DELETE', '/api-keys/not-a-uuid', { token: adminA })).status, 400);
});
