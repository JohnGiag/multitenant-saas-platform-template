import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SignJWT } from 'jose';
import { LOGIN_ACCOUNT_LIMIT, LOGIN_CEILING_LIMIT } from '../dist/modules/rate-limit/domain/rate-limit-policy.js';
import { cleanup, db, PASSWORD, randomIp, seedTenant, seedUser, startApp } from './helpers.mjs';

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

// Sign-in by email alone looks across tenants, so these use unique emails (seedUser).
const signIn = (body, ip) => call('POST', '/auth/login', { body, ...(ip && { ip }) });

test('email and password alone sign in when they match one account', async () => {
  const email = await seedUser(tenants.a, { role: 'TenantAdmin' });
  const res = await signIn({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  const me = await (await call('GET', '/auth/me', { token: (await res.json()).accessToken })).json();
  assert.deepEqual({ tenantId: me.tenantId, role: me.role }, { tenantId: tenants.a, role: 'TenantAdmin' });
});

test('when the password matches accounts in several tenants, the caller picks one of them', async () => {
  const email = await seedUser(tenants.a);
  await seedUser(tenants.b, { email, role: 'TenantAdmin' });
  const choice = await signIn({ email, password: PASSWORD });
  assert.equal(choice.status, 200);
  const { tenants: offered, accessToken } = await choice.json();
  assert.equal(accessToken, undefined);
  assert.deepEqual(offered.map((t) => t.name).sort(), ['auth-e2e-a', 'auth-e2e-b']);

  const picked = await signIn({ email, password: PASSWORD, tenantId: tenants.b });
  const me = await (await call('GET', '/auth/me', { token: (await picked.json()).accessToken })).json();
  assert.deepEqual({ tenantId: me.tenantId, role: me.role }, { tenantId: tenants.b, role: 'TenantAdmin' });
  // Picking still needs the password.
  assert.equal((await signIn({ email, password: 'wrong password', tenantId: tenants.b })).status, 401);
});

test('only tenants whose account accepts the password are offered, and nothing without it', async () => {
  const email = await seedUser(tenants.a, { password: 'the password for tenant a' });
  await seedUser(tenants.b, { email, password: 'the password for tenant b' });
  const res = await signIn({ email, password: 'the password for tenant b' });
  const me = await (await call('GET', '/auth/me', { token: (await res.json()).accessToken })).json();
  assert.equal(me.tenantId, tenants.b);

  const wrong = await signIn({ email, password: 'neither of them' });
  assert.equal(wrong.status, 401);
  assert.ok(!(await wrong.text()).includes('auth-e2e'), 'no tenant names without the password');
  assert.equal((await signIn({ email: `nobody-${crypto.randomUUID()}@example.com`, password: PASSWORD })).status, 401);
});

test('sign-in by email alone is limited per email and IP across tenants, and per email at a ceiling', async () => {
  const email = await seedUser(tenants.a);
  await seedUser(tenants.b, { email });
  const stranger = randomIp();
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) await signIn({ email, password: 'wrong password' }, stranger);
  const blocked = await signIn({ email, password: PASSWORD }, stranger);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // The owner, from another address, is not locked out by the stranger.
  assert.equal((await signIn({ email, password: 'wrong password' }, randomIp())).status, 401);

  // Spread over many addresses, guessing still hits the ceiling.
  const spread = await seedUser(tenants.a);
  for (let i = 0; i < LOGIN_CEILING_LIMIT; i++) await signIn({ email: spread, password: 'wrong password' }, randomIp());
  assert.equal((await signIn({ email: spread, password: PASSWORD }, randomIp())).status, 429);
  // Another email is unaffected.
  assert.equal((await signIn({ email: await seedUser(tenants.a), password: PASSWORD }, randomIp())).status, 200);
});
