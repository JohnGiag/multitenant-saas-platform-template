// A client retrying a write with the same Idempotency-Key gets the first response, not a second change.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ABANDONED_AFTER_MS, decideRetry, IDEMPOTENCY_TTL_MS } from '../dist/modules/idempotency/domain/idempotency-policy.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call, login;

// Invitations send an email: stubbed, like every offline test.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  String(input).startsWith('https://api.resend.com/') ? Promise.resolve(new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 })) : realFetch(input, init);

before(async () => {
  process.env.API_DOCS = 'true';
  tenants.platform = await seedTenant('idempotency-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('idempotency-e2e-a', { admin: 'TenantAdmin', other: 'TenantAdmin' });
  tenants.b = await seedTenant('idempotency-e2e-b', { admin: 'TenantAdmin' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.admin = await login(tenants.a, 'admin@example.com');
  tokens.other = await login(tenants.a, 'other@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const key = () => crypto.randomUUID();
const invite = (token, idempotencyKey, email = `x-${crypto.randomUUID()}@example.com`) =>
  call('POST', '/invitations', { token, body: { email, role: 'User' }, headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {} });
const invitations = (email) => db.invitation.count({ where: { email } });

test('what a retry gets, by the state of the row', () => {
  const claim = { principalId: 'p', requestHash: 'h' };
  const row = (status, ageMs = 0, extra = {}) => ({ ...claim, status, createdAt: new Date(1_000_000_000 - ageMs), ...extra });
  const decide = (...args) => decideRetry(row(...args), claim, 1_000_000_000);
  assert.equal(decide('done'), 'replay');
  assert.equal(decide('secret'), 'secret');
  assert.equal(decide('in_progress'), 'in_progress');
  assert.equal(decide('in_progress', ABANDONED_AFTER_MS), 'take_over', 'its process died');
  assert.equal(decide('done', IDEMPOTENCY_TTL_MS), 'take_over', 'expired');
  assert.equal(decide('done', 0, { requestHash: 'other' }), 'mismatch');
  assert.equal(decide('done', 0, { principalId: 'other' }), 'mismatch');
  assert.equal(decide('in_progress', 0, { requestHash: 'other' }), 'mismatch');
});

test('a retry gets the first response back and changes nothing', async () => {
  const email = `x-${crypto.randomUUID()}@example.com`;
  const idempotencyKey = key();
  const first = await invite(tokens.admin, idempotencyKey, email);
  assert.equal(first.status, 201);
  const body = await first.json();
  const audited = await db.auditLog.count({ where: { tenantId: tenants.a, route: '/v1/invitations' } });

  const retry = await invite(tokens.admin, idempotencyKey, email);
  assert.equal(retry.status, 201);
  assert.deepEqual(await retry.json(), body);
  assert.equal(await invitations(email), 1);
  assert.equal(await db.auditLog.count({ where: { tenantId: tenants.a, route: '/v1/invitations' } }), audited, 'a replay changes nothing to audit');
});

test('two concurrent identical requests create one resource', async () => {
  const email = `x-${crypto.randomUUID()}@example.com`;
  const idempotencyKey = key();
  const answers = await Promise.all(Array.from({ length: 5 }, () => invite(tokens.admin, idempotencyKey, email)));
  const statuses = answers.map((res) => res.status).sort();
  assert.ok(statuses.includes(201), statuses.join());
  assert.ok(statuses.every((status) => status === 201 || status === 409), statuses.join());
  assert.equal(await invitations(email), 1);
});

test('the same key on a different request is refused, also from another caller', async () => {
  const email = `x-${crypto.randomUUID()}@example.com`;
  const idempotencyKey = key();
  assert.equal((await invite(tokens.admin, idempotencyKey, email)).status, 201);
  const different = `x-${crypto.randomUUID()}@example.com`;
  assert.equal((await invite(tokens.admin, idempotencyKey, different)).status, 422);
  assert.equal(await invitations(different), 0);
  assert.equal((await invite(tokens.other, idempotencyKey, email)).status, 422, "another caller never gets someone's response");
});

test('a failed request frees its key, so a retry can succeed', async () => {
  const email = `x-${crypto.randomUUID()}@example.com`;
  const idempotencyKey = key();
  // Already a member: refused by the handler, after the guard reserved the key.
  await db.user.create({ data: { tenantId: tenants.a, email, role: 'User' } });
  const refused = await invite(tokens.admin, idempotencyKey, email);
  assert.ok(refused.status >= 400, String(refused.status));
  assert.equal(await db.idempotencyKey.count({ where: { tenantId: tenants.a, key: idempotencyKey } }), 0);

  await db.user.deleteMany({ where: { tenantId: tenants.a, email } });
  assert.equal((await invite(tokens.admin, idempotencyKey, email)).status, 201);
});

test('a response holding a secret is never stored, and a retry gets a 409 instead of a second key', async () => {
  const idempotencyKey = key();
  const create = () => call('POST', '/api-keys', { token: tokens.admin, body: { name: 'once' }, headers: { 'idempotency-key': idempotencyKey } });
  const created = await create();
  assert.equal(created.status, 201);
  const { id, key: secret } = await created.json();

  const row = await db.idempotencyKey.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenants.a, key: idempotencyKey } } });
  assert.equal(row.status, 'secret');
  assert.equal(row.responseBody, null);
  assert.ok(!JSON.stringify(row).includes(secret));

  const retry = await create();
  assert.equal(retry.status, 409);
  assert.ok(!(await retry.text()).includes(secret));
  assert.equal(await db.apiKey.count({ where: { tenantId: tenants.a, name: 'once' } }), 1);
  assert.equal(id, (await db.apiKey.findFirstOrThrow({ where: { tenantId: tenants.a, name: 'once' } })).id);
});

test("one tenant's key means nothing to another tenant", async () => {
  const idempotencyKey = key();
  const email = `x-${crypto.randomUUID()}@example.com`;
  const inA = await invite(tokens.admin, idempotencyKey, email);
  const inB = await invite(tokens.adminB, idempotencyKey, email);
  assert.equal(inA.status, 201);
  assert.equal(inB.status, 201);
  assert.notEqual((await inA.json()).id, (await inB.json()).id);
  assert.equal(await db.invitation.count({ where: { email } }), 2);
});

test('a key that expired or lost its process can be used again', async () => {
  const email = `x-${crypto.randomUUID()}@example.com`;
  const idempotencyKey = key();
  const hours = (n) => new Date(Date.now() - n * 60 * 60 * 1000);
  assert.equal((await invite(tokens.admin, idempotencyKey, email)).status, 201);
  await db.idempotencyKey.updateMany({ where: { tenantId: tenants.a, key: idempotencyKey }, data: { createdAt: hours(25) } });
  await db.invitation.deleteMany({ where: { email } });

  assert.equal((await invite(tokens.admin, idempotencyKey, email)).status, 201);
  assert.equal(await invitations(email), 1);
});

test('without the header a route works as before, and the header is checked', async () => {
  assert.equal((await invite(tokens.admin)).status, 201);
  assert.equal((await invite(tokens.admin, 'x'.repeat(256))).status, 400);
  assert.equal((await call('GET', '/users', { token: tokens.admin, headers: { 'idempotency-key': key() } })).status, 200, 'ignored where not opted in');
});

test('the OpenAPI document shows the header on every opted-in route', async () => {
  const spec = await (await fetch(`${app.getHttpServer().address().port && `http://127.0.0.1:${app.getHttpServer().address().port}`}/docs/openapi.json`)).json();
  const operation = (path) => spec.paths[path].post;
  for (const path of ['/v1/invitations', '/v1/api-keys', '/v1/tenants', '/v1/notifications']) {
    assert.ok(operation(path).parameters.some((p) => p.in === 'header' && p.name === 'Idempotency-Key'), path);
    assert.ok(operation(path).responses['422'], path);
  }
  assert.ok(!operation('/v1/auth/login').parameters?.some((p) => p.name === 'Idempotency-Key'));
});

test('deleting a tenant erases its keys, and old keys are swept at startup', async () => {
  const doomed = await seedTenant('idempotency-e2e-doomed', { admin: 'TenantAdmin' });
  const token = await login(doomed, 'admin@example.com');
  assert.equal((await invite(token, key())).status, 201);
  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);
  assert.equal(await db.idempotencyKey.count({ where: { tenantId: doomed } }), 0);

  const stale = await db.idempotencyKey.create({
    data: { tenantId: tenants.a, key: key(), principalId: crypto.randomUUID(), requestHash: 'h', status: 'done', createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1000) },
  });
  const restarted = await startApp();
  try {
    for (let i = 0; i < 100 && (await db.idempotencyKey.count({ where: { id: stale.id } })) > 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await db.idempotencyKey.count({ where: { id: stale.id } }), 0);
  } finally {
    await restarted.app.close();
  }
});
