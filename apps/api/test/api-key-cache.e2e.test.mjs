// Verified API keys are cached per instance, and revocation still reaches every instance on the next request.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { API_KEY_CACHE_TTL_MS, ApiKeyCache } from '../dist/modules/auth/domain/api-key-cache.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
let one, two, adminToken, superToken;

before(async () => {
  tenants.platform = await seedTenant('key-cache-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('key-cache-e2e-a', { admin: 'TenantAdmin' });
  one = await startApp();
  two = await startApp();
  adminToken = await one.login(tenants.a, 'admin@example.com');
  superToken = await one.login(tenants.platform, 'super@example.com');
});

after(() => cleanup([one?.app, two?.app], Object.values(tenants)));

const entry = (id, loadedAtMs = 1000) => ({ principal: { id }, secretHash: new Uint8Array(32), loadedAtMs });

async function createKey() {
  const res = await one.call('POST', '/api-keys', { token: adminToken, body: { name: `k-${crypto.randomUUID()}`, role: 'TenantAdmin' } });
  assert.equal(res.status, 201);
  return res.json();
}
const me = (app, key) => app.call('GET', '/auth/me', { apiKey: key });

test('entries expire, and the least recently used one goes first', () => {
  const cache = new ApiKeyCache();
  cache.set('p', entry('a'));
  assert.equal(cache.get('p', 1000 + API_KEY_CACHE_TTL_MS - 1).principal.id, 'a');
  assert.equal(cache.get('p', 1000 + API_KEY_CACHE_TTL_MS), undefined);

  for (let i = 0; i < 10_000; i++) cache.set(`k${i}`, entry(i));
  assert.ok(cache.get('k0', 1000), 'just used, so now the newest');
  cache.set('over', entry('over'));
  assert.ok(cache.get('k0', 1000));
  assert.equal(cache.get('k1', 1000), undefined, 'the oldest unused one made room');
});

test('repeated calls with one key do not read the database', async () => {
  const { id, key } = await createKey();
  assert.equal((await me(one, key)).status, 200);
  // Gone from the database, behind the cache's back: only a read would notice.
  await db.apiKey.delete({ where: { id } });
  for (let i = 0; i < 20; i++) assert.equal((await me(one, key)).status, 200);
  assert.equal((await me(two, key)).status, 401, 'another instance has its own cache');
});

test('a wrong secret is refused even when the key is cached', async () => {
  const { key } = await createKey();
  assert.equal((await me(one, key)).status, 200);
  const wrong = `${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await me(one, wrong)).status, 401);
  assert.equal((await me(one, key)).status, 200);
});

test('a revoked key is refused on the next request on every instance', async () => {
  const { id, key } = await createKey();
  assert.equal((await me(one, key)).status, 200);
  assert.equal((await me(two, key)).status, 200);
  assert.equal((await one.call('DELETE', `/api-keys/${id}`, { token: adminToken })).status, 204);
  assert.equal((await me(one, key)).status, 401);
  assert.equal((await me(two, key)).status, 401);
});

test('a tier change reaches cached keys, which keep working', async () => {
  const { key } = await createKey();
  assert.equal((await (await me(two, key)).json()).tier, 'free');
  assert.equal((await one.call('PATCH', `/tenants/${tenants.a}`, { token: superToken, body: { tier: 'pro' } })).status, 200);
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 5000;
    while ((await (await me(two, key)).json()).tier !== 'pro') {
      if (Date.now() > deadline) throw new Error('the tier never arrived');
    }
  });
});

test('deleting a tenant stops its cached keys at once', async () => {
  tenants.doomed = await seedTenant('key-cache-e2e-doomed', { admin: 'TenantAdmin' });
  const token = await one.login(tenants.doomed, 'admin@example.com');
  const { key } = await (await one.call('POST', '/api-keys', { token, body: { name: 'k' } })).json();
  assert.equal((await me(two, key)).status, 200);
  assert.equal((await one.call('DELETE', `/tenants/${tenants.doomed}`, { token: superToken })).status, 204);
  assert.equal((await me(two, key)).status, 401);
  delete tenants.doomed;
});
