// AUTH_PROVIDER=clerk, offline: a local server plays Clerk's JWKS endpoint, tokens are signed like
// Clerk session tokens (v2), and webhooks are signed like Svix signs them.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { TenantEvents } from '../dist/modules/events/domain/tenant-events.js';
import { cleanup, db, randomIp, startApp, waitFor } from './helpers.mjs';

const DASHBOARD = 'https://dashboard.example.test';
const WEBHOOK_KEY = randomBytes(32);
const run = crypto.randomUUID().slice(0, 8);
const org = (name) => `org_${name}_${run}`;
const clerkUser = (name) => `user_${name}_${run}`;

let issuer, jwksServer, signingKey, publicKey, otherKey, app, base, call;
// Every event the app publishes (what the webhooks module would deliver).
const published = [];

before(async () => {
  ({ privateKey: signingKey, publicKey } = await generateKeyPair('RS256'));
  ({ privateKey: otherKey } = await generateKeyPair('RS256'));
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  jwksServer = createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${jwksServer.address().port}`;

  Object.assign(process.env, {
    AUTH_PROVIDER: 'clerk',
    CLERK_ISSUER: issuer,
    CLERK_WEBHOOK_SECRET: `whsec_${WEBHOOK_KEY.toString('base64')}`,
    CLERK_AUTHORIZED_PARTIES: DASHBOARD,
  });
  ({ app, base, call } = await startApp());
  app.get(TenantEvents).subscribe(async (event) => void published.push(event));
});

after(async () => {
  const tenants = await db.tenant.findMany({ where: { clerkOrgId: { endsWith: run } }, select: { id: true } });
  await db.clerkDeletion.deleteMany({ where: { clerkId: { contains: run } } });
  await cleanup(app, tenants.map((t) => t.id));
  await new Promise((resolve) => jwksServer.close(resolve));
});

// A Clerk session token (v2): `o` is the active Organization.
function token(sub, orgId, { azp = DASHBOARD, key = signingKey, expires = '5m', iss = issuer } = {}) {
  return new SignJWT({ azp, v: 2, sid: `sess_${run}`, ...(orgId && { o: { id: orgId, rol: 'admin', slg: orgId } }) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(iss)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
}

// Signed like Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>".
// `at`: when Clerk created the event (ms); a retry delivers an old event with a fresh signature.
async function webhook(type, data, { key = WEBHOOK_KEY, ageSeconds = 0, rawBody, at = Date.now() } = {}) {
  const body = rawBody ?? JSON.stringify({ type, data, object: 'event', timestamp: at });
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const res = await fetch(`${base}/auth/clerk/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': randomIp(),
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body,
  });
  return res.status;
}

const membership = (orgId, userId, email, role = 'org:member', name = 'Org') => ({
  role,
  organization: { id: orgId, name },
  public_user_data: { user_id: userId, identifier: email },
});
const me = async (bearer) => {
  const res = await call('GET', '/auth/me', { token: await bearer });
  return res.status === 200 ? res.json() : res.status;
};
const memberOf = (orgId, userId) => db.user.findFirst({ where: { clerkUserId: userId, tenant: { clerkOrgId: orgId } } });

test('webhooks create the tenant and the member; their Clerk token then works', async () => {
  assert.equal(await webhook('organization.created', { id: org('acme'), name: 'Acme' }), 204);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org('acme') } });
  assert.deepEqual({ name: tenant.name, tier: tenant.tier }, { name: 'Acme', tier: 'free' });

  const ada = clerkUser('ada');
  assert.equal(await webhook('organizationMembership.created', membership(org('acme'), ada, 'Ada@Example.com', 'org:admin')), 204);
  const user = await memberOf(org('acme'), ada);
  assert.deepEqual({ email: user.email, role: user.role, passwordHash: user.passwordHash }, {
    email: 'ada@example.com',
    role: 'TenantAdmin',
    passwordHash: null,
  });

  assert.deepEqual(await me(token(ada, org('acme'))), {
    kind: 'user',
    id: user.id,
    tenantId: tenant.id,
    role: 'TenantAdmin',
    tier: 'free',
  });
});

test('role and tier come from our database, not from the token', async () => {
  const eve = clerkUser('eve');
  await webhook('organizationMembership.created', membership(org('acme'), eve, 'eve@example.com', 'org:admin'));
  await db.user.update({ where: { id: (await memberOf(org('acme'), eve)).id }, data: { role: 'Auditor' } });
  await db.tenant.update({ where: { clerkOrgId: org('acme') }, data: { tier: 'pro' } });
  const principal = await me(token(eve, org('acme')));
  assert.deepEqual({ role: principal.role, tier: principal.tier }, { role: 'Auditor', tier: 'pro' });
});

test('tokens fail closed', async () => {
  const ada = clerkUser('ada');
  assert.equal(await me(token(ada, undefined)), 401, 'no active organization');
  assert.equal(await me(token(ada, org('unknown'))), 401, 'organization we do not mirror');
  assert.equal(await me(token(clerkUser('stranger'), org('acme'))), 401, 'not a member');
  assert.equal(await me(token(ada, org('acme'), { key: otherKey })), 401, 'not signed by Clerk');
  assert.equal(await me(token(ada, org('acme'), { expires: '1s ago' })), 401, 'expired');
  assert.equal(await me(token(ada, org('acme'), { azp: 'https://evil.example' })), 401, 'issued to another site');
  assert.equal(await me(token(ada, org('acme'), { iss: 'https://other.clerk.accounts.dev' })), 401, 'another Clerk instance');
  assert.equal((await me(token(ada, org('acme')))).kind, 'user');
});

test('webhooks are refused unless signed, fresh and well-formed', async () => {
  const data = { id: org('forged'), name: 'Forged' };
  assert.equal(await webhook('organization.created', data, { key: randomBytes(32) }), 401);
  assert.equal(await webhook('organization.created', data, { ageSeconds: 600 }), 401, 'replayed later');
  assert.equal(await db.tenant.count({ where: { clerkOrgId: org('forged') } }), 0);
  assert.equal(await webhook('organization.created', { name: 'no id' }), 400);
  assert.equal(await webhook(null, null, { rawBody: '{"not":"an event"}' }), 400);
  // Events we do not mirror are acknowledged, so Clerk does not retry them forever.
  assert.equal(await webhook('session.created', { id: 'sess_1' }), 204);
});

test('deliveries are idempotent and may arrive out of order', async () => {
  const bo = clerkUser('bo');
  // The membership arrives before organization.created: the tenant is created from it.
  const event = membership(org('late'), bo, 'bo@example.com', 'org:member', 'Late Org');
  assert.equal(await webhook('organizationMembership.created', event), 204);
  assert.equal(await webhook('organizationMembership.created', event), 204);
  assert.equal(await webhook('organization.created', { id: org('late'), name: 'Late Org' }), 204);
  assert.equal(await db.tenant.count({ where: { clerkOrgId: org('late') } }), 1);
  assert.equal(await db.user.count({ where: { clerkUserId: bo } }), 1);
  assert.equal((await memberOf(org('late'), bo)).role, 'User');
});

test('a stale create or update retried after a deletion brings nothing back', async () => {
  const gil = clerkUser('gil');
  const created = Date.now() - 60_000;
  const event = membership(org('stale'), gil, 'gil@example.com');
  // The first delivery of each created event failed; the deletions got through.
  assert.equal(await webhook('organizationMembership.deleted', event), 204);
  assert.equal(await webhook('organizationMembership.created', event, { at: created }), 204, 'retried');
  assert.equal(await memberOf(org('stale'), gil), null);

  // Re-adding the member later is a newer event, so it counts.
  assert.equal(await webhook('organizationMembership.created', event), 204);
  assert.ok(await memberOf(org('stale'), gil));
  // ...and a late retry of the old deletion does not remove the re-added member.
  assert.equal(await webhook('organizationMembership.deleted', event, { at: created + 1 }), 204);
  assert.ok(await memberOf(org('stale'), gil));

  assert.equal(await webhook('user.deleted', { id: gil, deleted: true }), 204);
  assert.equal(await webhook('organizationMembership.created', event, { at: created }), 204);
  assert.equal(await db.user.count({ where: { clerkUserId: gil } }), 0, 'deleted user stays deleted');

  assert.equal(await webhook('organization.deleted', { id: org('stale'), deleted: true }), 204);
  assert.equal(await webhook('organization.updated', { id: org('stale'), name: 'Zombie' }, { at: created }), 204);
  assert.equal(await webhook('organizationMembership.created', membership(org('stale'), clerkUser('hal'), 'hal@example.com'), { at: created }), 204);
  assert.equal(await db.tenant.count({ where: { clerkOrgId: org('stale') } }), 0, 'deleted organization stays deleted');
});

test('an existing account with the same email is linked and keeps its role', async () => {
  await webhook('organization.created', { id: org('linked'), name: 'Linked' });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org('linked') } });
  await db.user.create({ data: { tenantId: tenant.id, email: 'cy@example.com', role: 'Auditor' } });
  const cy = clerkUser('cy');
  await webhook('organizationMembership.created', membership(org('linked'), cy, 'cy@example.com', 'org:admin'));
  const users = await db.user.findMany({ where: { tenantId: tenant.id } });
  assert.equal(users.length, 1);
  assert.deepEqual({ clerkUserId: users[0].clerkUserId, role: users[0].role }, { clerkUserId: cy, role: 'Auditor' });
});

test('email changes follow the Clerk user; leaving an organization or deleting the user removes access', async () => {
  const dee = clerkUser('dee');
  await webhook('organizationMembership.created', membership(org('one'), dee, 'dee@example.com'));
  await webhook('organizationMembership.created', membership(org('two'), dee, 'dee@example.com'));

  const updated = {
    id: dee,
    primary_email_address_id: 'idn_2',
    email_addresses: [
      { id: 'idn_1', email_address: 'dee@example.com' },
      { id: 'idn_2', email_address: 'Dee.New@Example.com' },
    ],
  };
  assert.equal(await webhook('user.updated', updated), 204);
  const emails = (await db.user.findMany({ where: { clerkUserId: dee } })).map((u) => u.email);
  assert.deepEqual(emails, ['dee.new@example.com', 'dee.new@example.com']);

  assert.equal(await webhook('organizationMembership.deleted', membership(org('two'), dee, 'dee.new@example.com')), 204);
  assert.equal(await me(token(dee, org('two'))), 401);
  assert.equal((await me(token(dee, org('one')))).kind, 'user');

  const [one, two] = await Promise.all(['one', 'two'].map((name) => db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org(name) } })));
  const memberIn = (tenantId) => published.find((e) => e.type === 'member.joined' && e.tenantId === tenantId)?.data.userId;
  await waitFor(() => memberIn(one.id) && memberIn(two.id));
  const [inOne, inTwo] = [memberIn(one.id), memberIn(two.id)];

  assert.equal(await webhook('user.deleted', { id: dee, deleted: true }), 204);
  assert.equal(await me(token(dee, org('one'))), 401);
  assert.equal(await db.user.count({ where: { clerkUserId: dee } }), 0);
  const removedFrom = (tenantId) => published.find((e) => e.type === 'member.removed' && e.tenantId === tenantId)?.data.userId;
  await waitFor(() => removedFrom(one.id) && removedFrom(two.id));
  assert.deepEqual([removedFrom(one.id), removedFrom(two.id)], [inOne, inTwo], 'leaving one organization, then deletion from the other');
});

test('an email already taken in one tenant skips the change there only', async () => {
  const eli = clerkUser('eli');
  await webhook('organizationMembership.created', membership(org('free'), eli, 'eli@example.com'));
  await webhook('organizationMembership.created', membership(org('taken'), eli, 'eli@example.com'));
  const taken = await db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org('taken') } });
  await db.user.create({ data: { tenantId: taken.id, email: 'eli.new@example.com' } });

  const updated = { id: eli, primary_email_address_id: 'idn_2', email_addresses: [{ id: 'idn_2', email_address: 'eli.new@example.com' }] };
  assert.equal(await webhook('user.updated', updated), 204);
  assert.equal((await memberOf(org('free'), eli)).email, 'eli.new@example.com');
  assert.equal((await memberOf(org('taken'), eli)).email, 'eli@example.com');
});

test('a late, older update changes neither an email nor a tenant name', async () => {
  const gus = clerkUser('gus');
  const start = Date.now() + 1000;
  await webhook('organizationMembership.created', membership(org('late'), gus, 'gus@example.com'), { at: start });
  const emailTo = (address) => ({ id: gus, primary_email_address_id: 'idn_1', email_addresses: [{ id: 'idn_1', email_address: address }] });

  assert.equal(await webhook('user.updated', emailTo('gus.newest@example.com'), { at: start + 2000 }), 204);
  assert.equal(await webhook('user.updated', emailTo('gus.older@example.com'), { at: start + 1000 }), 204);
  assert.equal((await memberOf(org('late'), gus)).email, 'gus.newest@example.com');

  await webhook('organization.updated', { id: org('late'), name: 'Newest' }, { at: start + 2000 });
  await webhook('organization.updated', { id: org('late'), name: 'Older' }, { at: start + 1000 });
  // A membership event carries the organization too, with the name it had then.
  await webhook('organizationMembership.created', membership(org('late'), clerkUser('hal'), 'hal@example.com'), { at: start + 1000 });
  assert.equal((await db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org('late') } })).name, 'Newest');
});

test('organization updates rename the tenant; deleting it removes the tenant and its data', async () => {
  await webhook('organization.created', { id: org('gone'), name: 'Gone Soon' });
  await webhook('organization.updated', { id: org('gone'), name: 'Renamed' });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { clerkOrgId: org('gone') } });
  assert.equal(tenant.name, 'Renamed');

  await webhook('organizationMembership.created', membership(org('gone'), clerkUser('fay'), 'fay@example.com'));
  await db.apiKey.create({ data: { tenantId: tenant.id, name: 'k', prefix: `p${run}`, secretHash: Uint8Array.of(1) } });
  await db.tenantIntegration.create({
    data: { tenantId: tenant.id, provider: 'resend', encryptedConfig: Uint8Array.of(1), maskedConfig: {} },
  });

  assert.equal(await webhook('organization.deleted', { id: org('gone'), deleted: true }), 204);
  assert.equal(await db.tenant.count({ where: { id: tenant.id } }), 0);
  for (const model of ['user', 'apiKey', 'tenantIntegration']) {
    assert.equal(await db[model].count({ where: { tenantId: tenant.id } }), 0, model);
  }
  assert.equal(await webhook('organization.deleted', { id: org('gone'), deleted: true }), 204, 'idempotent');
});

test('Clerk owns sign-in, passwords, invitations and membership lifecycle (409); roles stay ours', async () => {
  const admin = await token(clerkUser('ada'), org('acme'));
  const member = await memberOf(org('acme'), clerkUser('eve'));
  const as = (method, path, body) => call(method, path, { token: admin, body });

  const managed = [
    await call('POST', '/auth/login', { body: { tenantId: member.tenantId, email: 'ada@example.com', password: 'x' } }),
    await call('POST', '/auth/password-reset', { body: { tenantId: member.tenantId, email: 'ada@example.com' } }),
    await call('POST', '/auth/refresh', { body: { refreshToken: 'x' } }),
    await call('POST', '/auth/logout', { body: { refreshToken: 'x' } }),
    await as('POST', '/invitations', { email: 'new@example.com' }),
    await as('GET', '/invitations'),
    await as('DELETE', `/users/${member.id}`),
    await as('PUT', '/users/me/password', { currentPassword: 'x', newPassword: 'a long enough password' }),
    await as('PATCH', '/tenants/current', { name: 'Renamed here' }),
  ];
  assert.deepEqual(managed.map((r) => r.status), managed.map(() => 409));

  // Roles are ours in both modes.
  const promoted = await as('PATCH', `/users/${member.id}`, { role: 'User' });
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).role, 'User');

  // A SuperAdmin (made one in our database) cannot create or delete tenants here either.
  const root = clerkUser('root');
  await webhook('organizationMembership.created', membership(org('platform'), root, 'root@example.com'));
  await db.user.update({ where: { id: (await memberOf(org('platform'), root)).id }, data: { role: 'SuperAdmin' } });
  const superToken = await token(root, org('platform'));
  assert.equal((await call('POST', '/tenants', { token: superToken, body: { name: 'x' } })).status, 409);
  assert.equal((await call('DELETE', `/tenants/${member.tenantId}`, { token: superToken })).status, 409);
  // Nor rename one (the next organization.updated would undo it), but the tier is ours to set.
  const patchTenant = (body) => call('PATCH', `/tenants/${member.tenantId}`, { token: superToken, body });
  assert.equal((await patchTenant({ name: 'Renamed here' })).status, 409);
  assert.equal((await patchTenant({ name: 'Renamed here', tier: 'pro' })).status, 409);
  const retiered = await patchTenant({ tier: 'pro' });
  assert.equal(retiered.status, 200);
  assert.equal((await retiered.json()).tier, 'pro');
});
