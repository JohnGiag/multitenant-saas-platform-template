// Sessions in local auth: refresh rotation, replay detection, and access tokens that stop working at once.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AuthTokenSchema } from '@repo/shared-types';
import { signRefreshToken } from '../dist/modules/auth/domain/refresh-token.js';
import { newOneTimeToken } from '../dist/modules/users/domain/one-time-token.js';
import { cleanup, db, PASSWORD, seedTenant, seedUser, startApp, waitFor } from './helpers.mjs';

const NEW_PASSWORD = 'an entirely new passphrase';
const tenants = {};
let app, call, adminToken, superToken;

before(async () => {
  tenants.platform = await seedTenant('sessions-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('sessions-e2e-a', { admin: 'TenantAdmin' });
  tenants.b = await seedTenant('sessions-e2e-b');
  let login;
  ({ app, call, login } = await startApp());
  adminToken = await login(tenants.a, 'admin@example.com');
  superToken = await login(tenants.platform, 'super@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

async function signIn(email, password = PASSWORD) {
  const res = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(res.status, 200);
  return AuthTokenSchema.parse(await res.json());
}
const refresh = (refreshToken) => call('POST', '/auth/refresh', { body: { refreshToken } });
const me = (token) => call('GET', '/auth/me', { token });
const sessionOf = (tokens) => tokens.refreshToken.split('.')[1];
// As if the last rotation happened a minute ago: past the moment parallel requests are forgiven.
const ageRotation = (tokens) => db.authSession.update({ where: { id: sessionOf(tokens) }, data: { rotatedAt: new Date(Date.now() - 60_000) } });

test('a refresh token buys a new pair, and the session slides forward', async () => {
  const email = await seedUser(tenants.a);
  const first = await signIn(email);
  assert.equal(first.expiresIn, 15 * 60);
  assert.equal(first.refreshExpiresIn, 30 * 24 * 60 * 60);
  const row = await db.authSession.findUniqueOrThrow({ where: { id: sessionOf(first) } });
  assert.ok(!JSON.stringify(row).includes(first.refreshToken.split('.')[3]), 'the token is not stored');

  await db.authSession.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  const res = await refresh(first.refreshToken);
  assert.equal(res.status, 200);
  const second = AuthTokenSchema.parse(await res.json());
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal((await me(second.accessToken)).status, 200);
  const rotated = await db.authSession.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(rotated.generation, 1);
  assert.ok(rotated.expiresAt.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test('parallel refreshes of one token all get the same next token', async () => {
  const first = await signIn(await seedUser(tenants.a));
  const answers = await Promise.all([1, 2, 3, 4, 5].map(() => refresh(first.refreshToken)));
  const bodies = await Promise.all(answers.map((r) => r.json()));
  assert.deepEqual(answers.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(new Set(bodies.map((b) => b.refreshToken)).size, 1, 'whichever response the browser keeps still works');
  assert.equal((await db.authSession.findUniqueOrThrow({ where: { id: sessionOf(first) } })).generation, 1);
  assert.equal((await refresh(bodies[0].refreshToken)).status, 200);
});

test('a replayed token ends the session: refresh tokens and access tokens stop at once', async () => {
  const first = await signIn(await seedUser(tenants.a));
  const second = await (await refresh(first.refreshToken)).json();
  await ageRotation(first);

  assert.equal((await refresh(first.refreshToken)).status, 401);
  assert.equal((await refresh(second.refreshToken)).status, 401, 'the thief and the owner are both out');
  assert.equal((await me(second.accessToken)).status, 401);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(first) } }), 0);
});

test('sign-ins and replays reach the audit log, with ids only', async () => {
  const email = await seedUser(tenants.a);
  const { id: actorId, role: actorRole } = await db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email } });
  const first = await signIn(email);
  await refresh(first.refreshToken);
  await ageRotation(first);
  await refresh(first.refreshToken);

  const rows = await db.auditLog.findMany({ where: { tenantId: tenants.a, actorId }, orderBy: { id: 'asc' } });
  assert.deepEqual(
    rows.map(({ actorKind, actorRole, method, route, targetId, status }) => ({ actorKind, actorRole, method, route, targetId, status })),
    [
      { actorKind: 'user', actorRole, method: 'POST', route: '/v1/auth/login', targetId: null, status: 200 },
      { actorKind: 'user', actorRole, method: 'POST', route: '/v1/auth/refresh', targetId: sessionOf(first), status: 401 },
    ],
  );
});

test('a token two rotations old is a replay even within the moment parallel requests are forgiven', async () => {
  const first = await signIn(await seedUser(tenants.a));
  const second = await (await refresh(first.refreshToken)).json();
  await refresh(second.refreshToken);
  assert.equal((await refresh(first.refreshToken)).status, 401);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(first) } }), 0);
});

test('bad, expired and foreign refresh tokens are refused', async () => {
  const first = await signIn(await seedUser(tenants.a));
  assert.equal((await refresh('garbage')).status, 401);
  assert.equal((await refresh(`${first.refreshToken.slice(0, -2)}xx`)).status, 401);
  assert.equal((await call('POST', '/auth/refresh', { body: {} })).status, 400);

  // Correctly signed, but naming another tenant: the session is looked up within that tenant, and is not there.
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const foreign = signRefreshToken(key, { tenantId: tenants.b, sessionId: sessionOf(first), generation: 0 });
  assert.equal((await refresh(foreign)).status, 401);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(first) } }), 1, "another tenant's token cannot end it either");
  assert.equal((await call('POST', '/auth/logout', { body: { refreshToken: foreign } })).status, 204);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(first) } }), 1);

  await db.authSession.update({ where: { id: sessionOf(first) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await refresh(first.refreshToken)).status, 401);
});

test('signing in clears the sessions that expired, not the live ones', async () => {
  const email = await seedUser(tenants.a);
  const expired = await signIn(email);
  const live = await signIn(email);
  await db.authSession.update({ where: { id: sessionOf(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await signIn(email);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(expired) } }), 0);
  assert.equal(await db.authSession.count({ where: { id: sessionOf(live) } }), 1);
});

test('signing out ends that session at once, and only that one', async () => {
  const email = await seedUser(tenants.a);
  const [laptop, phone] = [await signIn(email), await signIn(email)];
  assert.equal((await call('POST', '/auth/logout', { body: { refreshToken: laptop.refreshToken } })).status, 204);
  assert.equal((await me(laptop.accessToken)).status, 401);
  assert.equal((await refresh(laptop.refreshToken)).status, 401);
  assert.equal((await me(phone.accessToken)).status, 200);
  assert.equal((await refresh(phone.refreshToken)).status, 200);
  assert.equal((await call('POST', '/auth/logout', { body: { refreshToken: 'garbage' } })).status, 204);
});

const userOf = (email) => db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email } });

test('a role change applies at once: the old token stops, and a refresh brings the new role', async () => {
  const email = await seedUser(tenants.a);
  const tokens = await signIn(email);
  const { id } = await userOf(email);
  assert.equal((await call('PATCH', `/users/${id}`, { token: adminToken, body: { role: 'Auditor' } })).status, 200);
  assert.equal((await me(tokens.accessToken)).status, 401);

  const renewed = await (await refresh(tokens.refreshToken)).json();
  assert.equal((await (await me(renewed.accessToken)).json()).role, 'Auditor');
});

test('a removed member is out at once', async () => {
  const email = await seedUser(tenants.a);
  const tokens = await signIn(email);
  const { id } = await userOf(email);
  assert.equal((await call('DELETE', `/users/${id}`, { token: adminToken })).status, 204);
  assert.equal((await me(tokens.accessToken)).status, 401);
  assert.equal((await refresh(tokens.refreshToken)).status, 401);
});

test('changing a password ends every session of the account, and only of that account', async () => {
  const email = await seedUser(tenants.a);
  const other = await signIn(await seedUser(tenants.a));
  const [laptop, phone] = [await signIn(email), await signIn(email)];
  const body = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
  assert.equal((await call('PUT', '/users/me/password', { token: laptop.accessToken, body })).status, 204);
  for (const tokens of [laptop, phone]) {
    assert.equal((await me(tokens.accessToken)).status, 401);
    assert.equal((await refresh(tokens.refreshToken)).status, 401);
  }
  assert.equal((await me(other.accessToken)).status, 200);
  assert.equal((await me((await signIn(email, NEW_PASSWORD)).accessToken)).status, 200);
});

test('a password reset ends every session of the account', async () => {
  const email = await seedUser(tenants.a);
  const tokens = await signIn(email);
  const { id } = await userOf(email);
  const { token, hash } = newOneTimeToken();
  await db.passwordReset.create({ data: { tenantId: tenants.a, userId: id, tokenHash: hash, expiresAt: new Date(Date.now() + 60_000) } });
  assert.equal((await call('POST', '/auth/password-reset/confirm', { body: { token, password: NEW_PASSWORD } })).status, 204);
  assert.equal((await me(tokens.accessToken)).status, 401);
  assert.equal((await refresh(tokens.refreshToken)).status, 401);
});

test('a tier change reaches members at their next refresh, moments later; other tenants are untouched', async () => {
  const tokens = await signIn(await seedUser(tenants.b));
  const elsewhere = await signIn(await seedUser(tenants.a));
  assert.equal((await call('PATCH', `/tenants/${tenants.b}`, { token: superToken, body: { tier: 'enterprise' } })).status, 200);
  await waitFor(async () => (await me(tokens.accessToken)).status === 401);
  assert.equal((await me(elsewhere.accessToken)).status, 200);
  const renewed = await (await refresh(tokens.refreshToken)).json();
  assert.equal((await (await me(renewed.accessToken)).json()).tier, 'enterprise');
});

test('deleting a tenant stops its tokens at once', async () => {
  tenants.doomed = await seedTenant('sessions-e2e-doomed');
  const tokens = await signIn(await seedUser(tenants.doomed));
  assert.equal((await call('DELETE', `/tenants/${tenants.doomed}`, { token: superToken })).status, 204);
  assert.equal((await me(tokens.accessToken)).status, 401);
  assert.equal((await refresh(tokens.refreshToken)).status, 401);
});
