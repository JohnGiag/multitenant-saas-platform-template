// Invitations and password resets, with Resend stubbed: each email is captured so the test can follow
// the link like the user would.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, beforeEach, test } from 'node:test';
import { LOGIN_ACCOUNT_LIMIT } from '../dist/modules/rate-limit/domain/rate-limit-policy.js';
import { cleanup, db, PASSWORD, seedTenant, seedUser, startApp, waitFor } from './helpers.mjs';

const NEW_PASSWORD = 'my very own passphrase';
const emails = [];
let respond = () => new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (!String(input).startsWith('https://api.resend.com/')) return realFetch(input, init);
  emails.push({ apiKey: new Headers(init.headers).get('authorization'), ...JSON.parse(String(init.body)) });
  return respond();
};
const tokenIn = (email) => /token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1];

const tenants = {};
const tokens = {};
const apps = [];
let call, login;

before(async () => {
  tenants.platform = await seedTenant('invite-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('invite-e2e-a', { admin: 'TenantAdmin', auditor: 'Auditor', user: 'User' });
  tenants.b = await seedTenant('invite-e2e-b', { admin: 'TenantAdmin' });
  const started = await startApp();
  apps.push(started.app);
  ({ call, login } = started);
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.auditor = await login(tenants.a, 'auditor@example.com');
  tokens.user = await login(tenants.a, 'user@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
  // Tenant A has its own Resend integration (used for notifications, never for links); tenant B has none.
  const configured = await call('PUT', '/integrations/resend', {
    token: tokens.adminA,
    body: { config: { apiKey: 're_tenant_a', from: 'Acme <hello@acme.test>' } },
  });
  assert.equal(configured.status, 200);
});

after(async () => {
  await cleanup(apps, Object.values(tenants));
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  emails.length = 0;
  respond = () => new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
});

const invite = (token, body, tenant) => call('POST', '/invitations', { token, tenant, body });
const accept = (token, password = NEW_PASSWORD) => call('POST', '/invitations/accept', { body: { token, password } });

// Emails carrying a link always go through the platform's Resend account: a tenant controlling the
// sending account could read the link in its logs and accept or reset in the user's place.
const PLATFORM = { apiKey: 'Bearer re_offline_test_suite', from: 'onboarding@resend.dev' };

test('a TenantAdmin invites; the platform sends it; the invitee chooses their password', async () => {
  const res = await invite(tokens.adminA, { email: 'New.Hire@Example.com', role: 'Auditor' });
  assert.equal(res.status, 201);
  const invitation = await res.json();
  assert.deepEqual(Object.keys(invitation).sort(), ['createdAt', 'email', 'expiresAt', 'id', 'role', 'tenantId']);
  assert.equal(invitation.email, 'new.hire@example.com');

  const [email] = emails;
  // Tenant A has its own Resend integration, and it is still not used.
  assert.deepEqual({ apiKey: email.apiKey, from: email.from, to: email.to }, { ...PLATFORM, to: ['new.hire@example.com'] });
  assert.match(email.text, /https:\/\/app\.example\.test\/accept-invitation\?token=/);
  assert.match(email.text, /as Auditor/);
  const token = tokenIn(email);
  // Only a hash is stored.
  const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.ok(!Buffer.from(row.tokenHash).toString('latin1').includes(token));

  const accepted = await accept(token);
  assert.equal(accepted.status, 201);
  assert.deepEqual(await accepted.json(), { tenantId: tenants.a, email: 'new.hire@example.com' });
  assert.equal(typeof (await login(tenants.a, 'new.hire@example.com', NEW_PASSWORD)), 'string');
  const user = await db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email: 'new.hire@example.com' } });
  assert.equal(user.role, 'Auditor');

  // Single use, and the invitation is gone.
  assert.equal((await accept(token)).status, 400);
  assert.equal(await db.invitation.count({ where: { id: invitation.id } }), 0);
});

test('a SuperAdmin invites into any tenant, also sent by the platform', async () => {
  const res = await invite(tokens.super, { email: 'first-admin@example.com', role: 'TenantAdmin' }, tenants.a);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).tenantId, tenants.a);
  assert.equal(emails[0].apiKey, PLATFORM.apiKey);
});

test('resending or re-inviting replaces the link; revoking voids it', async () => {
  const { id } = await (await invite(tokens.adminA, { email: 'rotating@example.com' })).json();
  const first = tokenIn(emails.at(-1));
  assert.equal((await call('POST', `/invitations/${id}/resend`, { token: tokens.adminA })).status, 200);
  const second = tokenIn(emails.at(-1));
  assert.notEqual(first, second);
  assert.equal((await accept(first)).status, 400);

  await invite(tokens.adminA, { email: 'rotating@example.com', role: 'Auditor' });
  const third = tokenIn(emails.at(-1));
  assert.equal((await accept(second)).status, 400);

  const pending = await (await call('GET', '/invitations', { token: tokens.adminA })).json();
  const mine = pending.items.filter((i) => i.email === 'rotating@example.com');
  assert.equal(mine.length, 1, 're-inviting replaces, it does not duplicate');
  assert.equal(mine[0].role, 'Auditor');
  assert.equal((await call('DELETE', `/invitations/${mine[0].id}`, { token: tokens.adminA })).status, 204);
  assert.equal((await accept(third)).status, 400);
});

test('an expired invitation cannot be accepted', async () => {
  const { id } = await (await invite(tokens.adminA, { email: 'late@example.com' })).json();
  await db.invitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await accept(tokenIn(emails.at(-1)))).status, 400);
});

test('rules: members, roles, who may invite, and tenant isolation', async () => {
  assert.equal((await invite(tokens.adminA, { email: 'user@example.com' })).status, 409);
  assert.equal((await invite(tokens.adminA, { email: 'x@example.com', role: 'SuperAdmin' })).status, 400);
  assert.equal((await invite(tokens.adminA, { email: 'x@example.com', password: PASSWORD })).status, 201);
  assert.equal(await db.user.count({ where: { email: 'x@example.com' } }), 0, 'no account before acceptance');

  assert.equal((await call('GET', '/invitations', { token: tokens.auditor })).status, 200);
  assert.equal((await invite(tokens.auditor, { email: 'y@example.com' })).status, 403);
  assert.equal((await call('GET', '/invitations', { token: tokens.user })).status, 403);

  const ofA = await db.invitation.findFirstOrThrow({ where: { tenantId: tenants.a } });
  // Tenant B's admin can neither revoke nor resend it: nothing is deleted, no email goes out.
  const sent = emails.length;
  assert.equal((await call('DELETE', `/invitations/${ofA.id}`, { token: tokens.adminB })).status, 404);
  assert.equal((await call('POST', `/invitations/${ofA.id}/resend`, { token: tokens.adminB })).status, 404);
  assert.equal(emails.length, sent);
  assert.equal(await db.invitation.count({ where: { id: ofA.id } }), 1);
});

test('when the email fails, no invitation is left behind', async () => {
  respond = () => new Response('{"message":"down"}', { status: 503 });
  const res = await invite(tokens.adminA, { email: 'unlucky@example.com' });
  assert.equal(res.status, 502);
  assert.equal(await db.invitation.count({ where: { email: 'unlucky@example.com' } }), 0);
});

test('without any email credentials, invitations are refused and nothing is kept', async () => {
  process.env.RESEND_PLATFORM_KEY = '';
  try {
    const bare = await startApp();
    apps.push(bare.app);
    const token = await bare.login(tenants.b, 'admin@example.com');
    const res = await bare.call('POST', '/invitations', { token, body: { email: 'nomail@example.com' } });
    assert.equal(res.status, 503);
    assert.equal(await db.invitation.count({ where: { email: 'nomail@example.com' } }), 0);
  } finally {
    process.env.RESEND_PLATFORM_KEY = 're_offline_test_suite';
  }
});

// Resets look up every account with the email, in any tenant, so these tests use unique emails (seedUser).
const requestReset = (email) => call('POST', '/auth/password-reset', { body: { email } });
const confirmReset = (token, password = NEW_PASSWORD) =>
  call('POST', '/auth/password-reset/confirm', { body: { token, password } });

test('password reset: the user gets a link and chooses a new password', async () => {
  const email = await seedUser(tenants.a);
  assert.equal((await requestReset(email)).status, 202);
  await waitFor(() => emails.length === 1);
  const [sent] = emails;
  // The audit case: a tenant admin owning the tenant's Resend account must not see reset links.
  assert.equal(sent.apiKey, PLATFORM.apiKey, 'reset links never go through a tenant-controlled account');
  assert.match(sent.text, /https:\/\/app\.example\.test\/reset-password\?token=/);

  assert.equal((await confirmReset(tokenIn(sent))).status, 204);
  assert.equal(await login(tenants.a, email), 401);
  assert.equal(typeof (await login(tenants.a, email, NEW_PASSWORD)), 'string');
  assert.equal((await confirmReset(tokenIn(sent))).status, 400, 'single use');
});

test('password reset reveals nothing about unknown accounts', async () => {
  const res = await requestReset(`nobody-${crypto.randomUUID()}@example.com`);
  assert.equal(res.status, 202);
  await sleep(300);
  assert.equal(emails.length, 0);
});

test('an expired reset link is refused', async () => {
  await requestReset(await seedUser(tenants.a, { role: 'Auditor' }));
  await waitFor(() => emails.length === 1);
  await db.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await confirmReset(tokenIn(emails[0]))).status, 400);
});

test('an email with accounts in several tenants gets one link per account, each naming its tenant', async () => {
  const email = await seedUser(tenants.a);
  await seedUser(tenants.b, { email });
  assert.equal((await requestReset(email)).status, 202);
  await waitFor(() => emails.length === 2);
  assert.deepEqual(emails.map((e) => e.subject).sort(), ['Reset your invite-e2e-a password', 'Reset your invite-e2e-b password']);

  // Each link resets only its own account.
  const forB = emails.find((e) => e.subject.includes('invite-e2e-b'));
  assert.equal((await confirmReset(tokenIn(forB))).status, 204);
  assert.equal(typeof (await login(tenants.b, email, NEW_PASSWORD)), 'string');
  assert.equal(typeof (await login(tenants.a, email)), 'string', 'the other account keeps its password');
});

test('a reset lifts a login lockout, and reset requests are limited per email', async () => {
  const email = await seedUser(tenants.a, { role: 'TenantAdmin' });
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) await login(tenants.a, email, 'wrong');
  assert.equal(await login(tenants.a, email), 429);
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) await call('POST', '/auth/login', { body: { email, password: 'wrong' } });
  assert.equal((await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status, 429);

  await requestReset(email);
  await waitFor(() => emails.length === 1);
  assert.equal((await confirmReset(tokenIn(emails[0]))).status, 204);
  // Both the per-account and the per-email lockout are lifted.
  assert.equal(typeof (await login(tenants.a, email, NEW_PASSWORD)), 'string');
  assert.equal((await call('POST', '/auth/login', { body: { email, password: NEW_PASSWORD } })).status, 200);

  for (let i = 1; i < LOGIN_ACCOUNT_LIMIT; i++) await requestReset(email);
  assert.equal((await requestReset(email)).status, 429);
});
