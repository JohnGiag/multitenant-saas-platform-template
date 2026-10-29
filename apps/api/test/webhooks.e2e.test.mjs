// Outbound webhooks delivered to a real HTTP receiver on this machine (WEBHOOKS_ALLOW_PRIVATE lets them reach it).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import {
  CreatedWebhookEndpointSchema,
  CORE_EVENT_TYPES,
  WebhookEndpointSchema,
  WebhookPayloadSchema,
  WebhookSecretSchema,
} from '@repo/shared-types';
import { verifyWebhookSignature } from '../dist/modules/auth/domain/webhook-signature.js';
import { cleanup, db, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';

// The receiver: records every request per path, and answers with the next status queued for that path (default 200).
const received = [];
const statuses = new Map();
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body });
    res.statusCode = statuses.get(req.url)?.shift() ?? 200;
    res.end();
  });
});
let base;

const tenants = {};
const tokens = {};
let app, call, login;

before(async () => {
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${receiver.address().port}`;
  tenants.platform = await seedTenant('webhooks-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('webhooks-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor', member: 'User' });
  tenants.b = await seedTenant('webhooks-e2e-b', { admin: 'TenantAdmin' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(async () => {
  receiver.close();
  for (const name of ['webhooks', 'webhooks-dlq']) {
    const queue = testQueue(name);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  await cleanup(app, Object.values(tenants));
});

const create = (token, body) => call('POST', '/webhooks', { token, body });
async function endpoint(token, path, extra = {}) {
  const res = await create(token, { url: `${base}${path}`, ...extra });
  assert.equal(res.status, 201, await res.clone().text());
  return CreatedWebhookEndpointSchema.parse(await res.json());
}
const deliveriesTo = (path) => received.filter((r) => r.path === path);
const lastTo = async (path, count = 1) => {
  await waitFor(() => deliveriesTo(path).length >= count);
  return deliveriesTo(path).at(-1);
};
const createKey = (token = tokens.adminA) => call('POST', '/api-keys', { token, body: { name: `k-${crypto.randomUUID()}` } });

// What a receiver does with a delivery, using the same Standard Webhooks check this API applies to Clerk's.
function verify(delivery, secret) {
  return verifyWebhookSignature({
    secret,
    id: delivery.headers['webhook-id'],
    timestamp: delivery.headers['webhook-timestamp'],
    signatures: delivery.headers['webhook-signature'],
    body: delivery.body,
  });
}

test('admins manage endpoints, auditors read them, users and SuperAdmin get nothing', async () => {
  assert.equal((await create(tokens.userA, { url: `${base}/roles` })).status, 403);
  assert.equal((await create(tokens.auditorA, { url: `${base}/roles` })).status, 403);
  assert.equal((await call('GET', '/webhooks', { token: tokens.userA })).status, 403);
  assert.equal((await call('GET', '/webhooks', { token: tokens.super, tenant: tenants.a })).status, 403);

  const created = await endpoint(tokens.adminA, '/roles', { description: 'CRM sync' });
  assert.match(created.secret, /^whsec_/);
  const list = await (await call('GET', '/webhooks', { token: tokens.auditorA })).json();
  const listed = list.items.find((e) => e.id === created.id);
  assert.deepEqual(WebhookEndpointSchema.parse(listed), listed);
  assert.equal(listed.description, 'CRM sync');
  assert.ok(!JSON.stringify(list).includes(created.secret), 'the secret is never listed');

  const types = (await (await call('GET', '/webhooks/event-types', { token: tokens.auditorA })).json()).types;
  for (const type of CORE_EVENT_TYPES) assert.ok(types.includes(type), type);
  await call('DELETE', `/webhooks/${created.id}`, { token: tokens.adminA });
});

test('bad endpoints are refused: credentials in the URL, unknown event types, and more than 10 per tenant', async () => {
  assert.equal((await create(tokens.adminA, { url: 'http://user:pass@127.0.0.1/x' })).status, 400);
  assert.equal((await create(tokens.adminA, { url: `${base}/x`, events: ['no.such_event'] })).status, 400);
  assert.equal((await create(tokens.adminA, { url: 'ftp://example.com/x' })).status, 400);

  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await endpoint(tokens.adminB, `/limit-${i}`)).id);
  const eleventh = await create(tokens.adminB, { url: `${base}/limit-10` });
  assert.equal(eleventh.status, 409);
  for (const id of ids) assert.equal((await call('DELETE', `/webhooks/${id}`, { token: tokens.adminB })).status, 204);
});

test("an event reaches the tenant's endpoints, signed so the receiver can verify it", async () => {
  const { secret } = await endpoint(tokens.adminA, '/all');
  const key = await (await createKey()).json();

  const delivery = await lastTo('/all');
  assert.equal(delivery.headers['content-type'], 'application/json');
  assert.equal(verify(delivery, secret), true);
  const payload = WebhookPayloadSchema.parse(JSON.parse(delivery.body));
  assert.equal(payload.id, delivery.headers['webhook-id']);
  assert.deepEqual({ type: payload.type, tenantId: payload.tenantId, data: payload.data }, {
    type: 'api_key.created',
    tenantId: tenants.a,
    data: { apiKeyId: key.id, role: 'User' },
  });
  // Ids only: nothing that names a person leaves the platform.
  assert.ok(!delivery.body.includes('@example.com'));
});

test('endpoints get only the event types they asked for, and nothing from other tenants', async () => {
  await endpoint(tokens.adminA, '/only-revoked', { events: ['api_key.revoked'] });
  await endpoint(tokens.adminB, '/tenant-b');
  const before = deliveriesTo('/all').length;
  const key = await (await createKey()).json();
  await lastTo('/all', before + 1);
  assert.equal(deliveriesTo('/only-revoked').length, 0, 'api_key.created is not one it wants');

  assert.equal((await call('DELETE', `/api-keys/${key.id}`, { token: tokens.adminA })).status, 204);
  const revoked = JSON.parse((await lastTo('/only-revoked')).body);
  assert.deepEqual({ type: revoked.type, data: revoked.data }, { type: 'api_key.revoked', data: { apiKeyId: key.id } });
  assert.equal(deliveriesTo('/tenant-b').length, 0, "tenant A's events never reach tenant B");
});

test("one tenant cannot see, change, test or remove another tenant's endpoint", async () => {
  const theirs = await endpoint(tokens.adminA, '/private');
  const list = await (await call('GET', '/webhooks', { token: tokens.adminB })).json();
  assert.ok(!list.items.some((e) => e.id === theirs.id));
  const path = `/webhooks/${theirs.id}`;
  assert.equal((await call('PATCH', path, { token: tokens.adminB, body: { url: `${base}/stolen` } })).status, 404);
  assert.equal((await call('POST', `${path}/rotate-secret`, { token: tokens.adminB })).status, 404);
  assert.equal((await call('POST', `${path}/test`, { token: tokens.adminB })).status, 404);
  assert.equal((await call('DELETE', path, { token: tokens.adminB })).status, 404);
  assert.equal((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: theirs.id } })).url, `${base}/private`);
  await call('DELETE', path, { token: tokens.adminA });
});

test('a test event goes to that endpoint only; a disabled endpoint gets nothing', async () => {
  const target = await endpoint(tokens.adminA, '/test-me');
  assert.equal((await call('POST', `/webhooks/${target.id}/test`, { token: tokens.adminA })).status, 202);
  const delivery = await lastTo('/test-me');
  assert.equal(JSON.parse(delivery.body).type, 'webhook.test');
  assert.equal(verify(delivery, target.secret), true);

  const off = await call('PATCH', `/webhooks/${target.id}`, { token: tokens.adminA, body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).enabled, false);
  assert.equal((await call('POST', `/webhooks/${target.id}/test`, { token: tokens.adminA })).status, 409);
  // Waits for this event to reach the catch-all endpoint, so the disabled one has had its chance too.
  const before = deliveriesTo('/all').length;
  await createKey();
  await lastTo('/all', before + 1);
  assert.equal(deliveriesTo('/test-me').length, 1, 'disabled: no event delivered');
});

test('a rotated secret signs from then on, and the old one no longer verifies', async () => {
  const target = await endpoint(tokens.adminA, '/rotate');
  const res = await call('POST', `/webhooks/${target.id}/rotate-secret`, { token: tokens.adminA });
  assert.equal(res.status, 200);
  const { secret } = WebhookSecretSchema.parse(await res.json());
  assert.notEqual(secret, target.secret);
  await call('POST', `/webhooks/${target.id}/test`, { token: tokens.adminA });
  const delivery = await lastTo('/rotate');
  assert.equal(verify(delivery, secret), true);
  assert.equal(verify(delivery, target.secret), false);
});

test('a failing receiver gets the event again; one that refuses it sends it to the dead-letter queue', async () => {
  const flaky = await endpoint(tokens.adminA, '/flaky', { events: ['member.role_changed'] });
  const refusing = await endpoint(tokens.adminA, '/refusing', { events: ['member.role_changed'] });
  statuses.set('/flaky', [503]);
  statuses.set('/refusing', [404]);

  const member = await db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email: 'member@example.com' } });
  assert.equal((await call('PATCH', `/users/${member.id}`, { token: tokens.adminA, body: { role: 'Auditor' } })).status, 200);

  // 503, then the first retry 5 seconds later.
  const second = await lastTo('/flaky', 2);
  const [first] = deliveriesTo('/flaky');
  assert.equal(first.headers['webhook-id'], second.headers['webhook-id'], 'the same event, so receivers can dedupe');
  assert.equal(verify(second, flaky.secret), true, 're-signed for the retry');
  assert.deepEqual(JSON.parse(second.body).data, { userId: member.id, role: 'Auditor' });

  // 404: not retried.
  const dlq = testQueue('webhooks-dlq');
  await waitFor(async () => (await dlq.getJobs(['wait'])).some((j) => j.data.payload.endpointId === refusing.id));
  assert.equal(deliveriesTo('/refusing').length, 1);
  const [dead] = (await dlq.getJobs(['wait'])).filter((j) => j.data.payload.endpointId === refusing.id);
  assert.match(dead.data.failedReason, /answered 404/);
  await dlq.close();
});

test('tier changes and member changes elsewhere in the API are published too', async () => {
  await endpoint(tokens.adminB, '/tier', { events: ['tenant.tier_changed'] });
  assert.equal((await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.super, body: { tier: 'pro' } })).status, 200);
  const tier = JSON.parse((await lastTo('/tier')).body);
  assert.deepEqual({ type: tier.type, tenantId: tier.tenantId, data: tier.data }, {
    type: 'tenant.tier_changed',
    tenantId: tenants.b,
    data: { tier: 'pro', previousTier: 'free' },
  });
  // Renaming is not a tier change.
  await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.super, body: { name: 'webhooks-e2e-b', tier: 'pro' } });

  await endpoint(tokens.adminA, '/removed', { events: ['member.removed'] });
  const member = await db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email: 'member@example.com' } });
  assert.equal((await call('DELETE', `/users/${member.id}`, { token: tokens.adminA })).status, 204);
  assert.deepEqual(JSON.parse((await lastTo('/removed')).body).data, { userId: member.id });
  assert.equal(deliveriesTo('/tier').length, 1, 'no event for an unchanged tier');
});
