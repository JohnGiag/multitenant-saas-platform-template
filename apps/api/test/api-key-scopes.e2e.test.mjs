// API key scopes and test mode: a key reaches only what it was given, and test data never meets live data.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ApiScopes } from '../dist/modules/auth/domain/api-scopes.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, base, call, login;

before(async () => {
  process.env.API_DOCS = 'true';
  tenants.platform = await seedTenant('scopes-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('scopes-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('scopes-e2e-b', { admin: 'TenantAdmin' });
  // Enterprise: the walk over every route stays below its rate limit.
  await db.tenant.updateMany({ where: { id: { in: [tenants.a, tenants.b] } }, data: { tier: 'enterprise' } });
  ({ app, base, call, login } = await startApp());
  app.get(ApiScopes).declare('ingest');
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.admin = await login(tenants.a, 'admin@example.com');
  tokens.user = await login(tenants.a, 'user@example.com');
  tokens.auditor = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const SANDBOX = { 'x-sandbox': 'true' };
async function createKey(body, options = { token: tokens.admin }) {
  const res = await call('POST', '/api-keys', { ...options, body: { name: `k-${crypto.randomUUID()}`, ...body } });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
const inTest = {
  get token() {
    return tokens.admin;
  },
  headers: SANDBOX,
};
const listKeys = async (options) => (await (await call('GET', '/api-keys', options)).json()).items.map((k) => k.id);
const sandboxOf = async (id) => (await db.tenant.findUnique({ where: { sandboxOf: id } }))?.id;

test('a new key holds the core scopes unless told otherwise, and only declared scopes exist', async () => {
  assert.deepEqual((await createKey()).scopes, ['read', 'write']);
  const { key, scopes } = await createKey({ role: 'TenantAdmin', scopes: ['read', 'read'] });
  assert.deepEqual(scopes, ['read']);
  assert.deepEqual((await (await call('GET', '/auth/me', { apiKey: key })).json()).scopes, ['read']);

  const unknown = await call('POST', '/api-keys', { token: tokens.admin, body: { name: 'x', scopes: ['no-such-scope'] } });
  assert.equal(unknown.status, 400);
  assert.equal((await call('POST', '/api-keys', { token: tokens.admin, body: { name: 'x', scopes: [] } })).status, 400);

  const listed = await (await call('GET', '/api-keys/scopes', { token: tokens.auditor })).json();
  assert.deepEqual(listed.scopes, ['ingest', 'read', 'write']);
});

test('read lets a key read, write lets it write, and neither widens its role', async () => {
  const reader = await createKey({ role: 'TenantAdmin', scopes: ['read'] });
  assert.equal((await call('GET', '/api-keys', { apiKey: reader.key })).status, 200);
  assert.equal((await call('POST', '/api-keys', { apiKey: reader.key, body: { name: 'y' } })).status, 403);

  const writer = await createKey({ role: 'TenantAdmin', scopes: ['write'] });
  assert.equal((await call('GET', '/api-keys', { apiKey: writer.key })).status, 403);
  assert.equal((await call('POST', '/api-keys', { apiKey: writer.key, body: { name: 'y' } })).status, 201);

  const user = await createKey({ role: 'User', scopes: ['read', 'write'] });
  assert.equal((await call('GET', '/api-keys', { apiKey: user.key })).status, 403, 'the role still decides');
});

test('an ingest-only key is refused on every route that takes credentials', async () => {
  const { key } = await createKey({ role: 'TenantAdmin', scopes: ['ingest'] });
  const spec = await (await fetch(`${base.replace(/\/v1$/, '')}/docs/openapi.json`)).json();
  let walked = 0;
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation.security) continue;
      const res = await call(method.toUpperCase(), path.replace('/v1', '').replace(/\{\w+\}/g, crypto.randomUUID()), { apiKey: key });
      assert.equal(res.status, 403, `${method} ${path}`);
      walked++;
    }
  }
  assert.ok(walked > 30, `only ${walked} routes`);
});

test('test mode: keys made there are test keys in the sandbox, and live and test never see each other', async () => {
  const live = await createKey({ role: 'TenantAdmin' });
  assert.match(live.key, /^sk_live_[0-9a-f]{12}_/);
  const testKey = await createKey({ role: 'TenantAdmin' }, inTest);
  assert.match(testKey.key, /^sk_test_[0-9a-f]{12}_/);

  const sandbox = await sandboxOf(tenants.a);
  assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: testKey.id } })).tenantId, sandbox);
  assert.equal((await (await call('GET', '/auth/me', { apiKey: testKey.key })).json()).mode, 'test');

  // Reads, both ways, by a member switching and by a key.
  assert.ok((await listKeys({ token: tokens.admin })).includes(live.id));
  assert.ok(!(await listKeys({ token: tokens.admin })).includes(testKey.id));
  assert.ok((await listKeys(inTest)).includes(testKey.id));
  assert.ok(!(await listKeys(inTest)).includes(live.id));
  assert.ok(!(await listKeys({ apiKey: testKey.key })).includes(live.id));
  assert.ok(!(await listKeys({ apiKey: live.key })).includes(testKey.id));

  // Writes, both ways.
  assert.equal((await call('DELETE', `/api-keys/${live.id}`, { apiKey: testKey.key })).status, 404);
  assert.equal((await call('DELETE', `/api-keys/${testKey.id}`, { apiKey: live.key })).status, 404);
  assert.equal((await call('GET', '/auth/me', { apiKey: live.key })).status, 200);

  // The mode is part of the key: renaming a test key "live" is no key at all.
  assert.equal((await call('GET', '/auth/me', { apiKey: testKey.key.replace('sk_test_', 'sk_live_') })).status, 401);
});

test('a role carries into the sandbox, and only members may switch', async () => {
  assert.equal((await call('POST', '/api-keys', { ...inTest, token: tokens.user, body: { name: 'x' } })).status, 403);
  assert.equal((await call('POST', '/api-keys', { ...inTest, token: tokens.auditor, body: { name: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api-keys', { ...inTest, token: tokens.auditor })).status, 200);

  const { key: liveKey } = await createKey({ role: 'TenantAdmin' });
  const { key: testKey } = await createKey({ role: 'TenantAdmin' }, inTest);
  assert.equal((await call('GET', '/api-keys', { apiKey: liveKey, headers: SANDBOX })).status, 403, 'a live key stays live');
  assert.equal((await call('GET', '/api-keys', { apiKey: testKey, headers: SANDBOX })).status, 403);
  assert.equal((await call('GET', '/tenants/current', { token: tokens.super, headers: SANDBOX })).status, 403, 'SuperAdmin stays out');
  assert.equal((await call('GET', '/tenants/current', { token: tokens.super, tenant: tenants.a, headers: SANDBOX })).status, 403);
  assert.equal((await call('GET', '/api-keys', { token: tokens.admin, headers: { 'x-sandbox': 'yes' } })).status, 400);
});

test("one tenant's sandbox is out of reach of another tenant", async () => {
  const { id } = await createKey({}, inTest);
  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: tokens.adminB, headers: SANDBOX })).status, 404);
  assert.ok(!(await listKeys({ token: tokens.adminB, headers: SANDBOX })).includes(id));
  assert.notEqual(await sandboxOf(tenants.a), await sandboxOf(tenants.b));
});

test('what reaches the outside world for real stays live: no invitations in test mode', async () => {
  const body = { email: `x-${crypto.randomUUID()}@example.com`, role: 'User' };
  const { key } = await createKey({ role: 'TenantAdmin' }, inTest);
  assert.equal((await call('POST', '/invitations', { ...inTest, body })).status, 403);
  assert.equal((await call('POST', '/invitations', { apiKey: key, body })).status, 403);
});

test('a sandbox has no plan of its own: it may use what its live tenant may', async () => {
  const sandbox = await sandboxOf(tenants.a);
  assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: sandbox } })).tier, 'free');
  const { key } = await createKey({}, inTest);
  assert.equal((await (await call('GET', '/auth/me', { apiKey: key })).json()).tier, 'enterprise');
});

test('two first requests at once make one sandbox', async () => {
  tenants.fresh = await seedTenant('scopes-e2e-fresh', { admin: 'TenantAdmin' });
  const token = await login(tenants.fresh, 'admin@example.com');
  const answers = await Promise.all(Array.from({ length: 5 }, () => call('GET', '/tenants/current', { token, headers: SANDBOX })));
  assert.deepEqual([...new Set(answers.map((res) => res.status))], [200]);
  assert.equal(new Set(await Promise.all(answers.map(async (res) => (await res.json()).id))).size, 1);
});

test('SuperAdmin never sees sandboxes, and deleting a tenant erases its sandbox', async () => {
  const doomed = await seedTenant('scopes-e2e-doomed', { admin: 'TenantAdmin' });
  const token = await login(doomed, 'admin@example.com');
  const testKey = await createKey({}, { token, headers: SANDBOX });
  const sandbox = await sandboxOf(doomed);

  const names = (await (await call('GET', '/tenants?limit=100', { token: tokens.super })).json()).items.map((t) => t.id);
  assert.ok(!names.includes(sandbox));

  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);
  assert.equal(await db.tenant.count({ where: { id: { in: [doomed, sandbox] } } }), 0);
  assert.equal(await db.apiKey.count({ where: { id: testKey.id } }), 0);
  assert.equal((await call('GET', '/auth/me', { apiKey: testKey.key })).status, 401);
});
