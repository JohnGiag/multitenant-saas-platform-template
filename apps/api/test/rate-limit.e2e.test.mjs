import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LOGIN_ACCOUNT_LIMIT, LOGIN_CEILING_LIMIT, PUBLIC_LIMIT, TIER_LIMITS } from '../dist/modules/rate-limit/domain/rate-limit-policy.js';
import { cleanup, db, PASSWORD, randomIp, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call, login;

// The dashboard's secret: with it, the dashboard's forwarded browser IP picks the public-route bucket.
const DASHBOARD_SECRET = 'test-dashboard-proxy-secret-0123456789';

before(async () => {
  process.env.DASHBOARD_PROXY_SECRET = DASHBOARD_SECRET;
  tenants.free = await seedTenant('rl-e2e-free', { a: 'User', b: 'User', c: 'User', d: 'User', admin: 'TenantAdmin' });
  tenants.pro = await seedTenant('rl-e2e-pro', { a: 'User' });
  await db.tenant.update({ where: { id: tenants.pro }, data: { tier: 'pro' } });
  ({ app, call, login } = await startApp());
  tokens.a = await login(tenants.free, 'a@example.com');
  tokens.b = await login(tenants.free, 'b@example.com');
  tokens.admin = await login(tenants.free, 'admin@example.com');
  tokens.pro = await login(tenants.pro, 'a@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const header = (res, name) => Number(res.headers.get(name));

test('each caller gets its tier limit, then 429 with Retry-After', async () => {
  const limit = TIER_LIMITS.free;
  const first = await call('GET', '/auth/me', { token: tokens.a });
  assert.equal(header(first, 'x-ratelimit-limit'), limit);
  assert.equal(header(first, 'x-ratelimit-remaining'), limit - 1);

  for (let i = 1; i < limit; i++) assert.equal((await call('GET', '/auth/me', { token: tokens.a })).status, 200);
  const denied = await call('GET', '/auth/me', { token: tokens.a });
  assert.equal(denied.status, 429);
  assert.equal(header(denied, 'x-ratelimit-remaining'), 0);
  const retryAfter = header(denied, 'retry-after');
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);

  // Another user and an API key of the same tenant have their own buckets.
  assert.equal((await call('GET', '/auth/me', { token: tokens.b })).status, 200);
  const { key } = await (await call('POST', '/api-keys', { token: tokens.admin, body: { name: 'rl' } })).json();
  const viaKey = await call('GET', '/auth/me', { apiKey: key });
  assert.equal(viaKey.status, 200);
  assert.equal(header(viaKey, 'x-ratelimit-remaining'), limit - 1);
});

test('the tier sets the limit', async () => {
  const res = await call('GET', '/auth/me', { token: tokens.pro });
  assert.equal(header(res, 'x-ratelimit-limit'), TIER_LIMITS.pro);
});

test('rejected credentials are limited per client IP too', async () => {
  const ip = randomIp();
  // Well-formed, so each one costs a database lookup before it is refused.
  const fakeKey = `sk_live_${'0'.repeat(12)}_${'A'.repeat(43)}`;
  for (let i = 0; i < PUBLIC_LIMIT; i++) assert.equal((await call('GET', '/auth/me', { apiKey: fakeKey, ip })).status, 401);
  const blocked = await call('GET', '/auth/me', { apiKey: fakeKey, ip });
  assert.equal(blocked.status, 429);
  assert.ok(header(blocked, 'retry-after') >= 1);
  // Valid callers from the same IP keep their own bucket.
  assert.equal((await call('GET', '/auth/me', { token: tokens.b, ip })).status, 200);
});

const loginAs = (email, password, ip) =>
  call('POST', '/auth/login', { ip, body: { tenantId: tenants.free, email, password } });

test('login is limited per client IP, even with the right password', async () => {
  const ip = randomIp();
  // A different (unknown) account each time, so only the per-IP limit applies.
  for (let i = 0; i < PUBLIC_LIMIT; i++) assert.equal((await loginAs(`nobody${i}@example.com`, 'x', ip)).status, 401);
  const blocked = await loginAs('a@example.com', PASSWORD, ip);
  assert.equal(blocked.status, 429);
  assert.ok(header(blocked, 'retry-after') >= 1);

  assert.equal((await loginAs('a@example.com', PASSWORD, randomIp())).status, 200);
});

test("login is limited per account and IP, so a stranger's guesses cannot lock the owner out", async () => {
  const stranger = randomIp();
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) assert.equal((await loginAs('c@example.com', 'wrong', stranger)).status, 401);
  const blocked = await loginAs('c@example.com', PASSWORD, stranger);
  assert.equal(blocked.status, 429);
  const retryAfter = header(blocked, 'retry-after');
  assert.ok(retryAfter >= 1 && retryAfter <= 15 * 60, `Retry-After ${retryAfter}`);

  // The owner, from another address, still gets in; so do other accounts from the blocked address.
  assert.equal((await loginAs('c@example.com', PASSWORD, randomIp())).status, 200);
  assert.equal((await loginAs('b@example.com', PASSWORD, stranger)).status, 200);
});

test('changing address within an IPv6 /64 does not get around the per-account limit', async () => {
  const block = `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:1::`;
  for (let i = 1; i <= LOGIN_ACCOUNT_LIMIT; i++) {
    assert.equal((await loginAs('admin@example.com', 'wrong', `${block}${i.toString(16)}`)).status, 401);
  }
  assert.equal((await loginAs('admin@example.com', 'wrong', `${block}ffff`)).status, 429);
  assert.equal((await loginAs('admin@example.com', PASSWORD, randomIp())).status, 200, 'the owner is not locked out');
});

test('login is limited per account across IPs at a higher ceiling, even with the right password', async () => {
  for (let i = 0; i < LOGIN_CEILING_LIMIT; i++) assert.equal((await loginAs('e@example.com', 'wrong', randomIp())).status, 401);
  assert.equal((await loginAs('e@example.com', PASSWORD, randomIp())).status, 429);
});

test("a successful login clears this IP's account counter", async () => {
  const ip = randomIp();
  const fail = () => loginAs('d@example.com', 'wrong', ip);
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT - 1; i++) assert.equal((await fail()).status, 401);
  assert.equal((await loginAs('d@example.com', PASSWORD, ip)).status, 200);
  // Without the reset, the second of these would already be the 11th attempt and get a 429.
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT - 1; i++) assert.equal((await fail()).status, 401, `attempt ${i + 1}`);
});

test("the dashboard's forwarded browser IP picks the bucket, but only with the dashboard's secret", async () => {
  const [dashboard, browserA, browserB] = [randomIp(), randomIp(), randomIp()];
  // `ip` is the address the API sees connecting (here: through the test's trusted proxy hop).
  const login = (ip, extra) =>
    call('POST', '/auth/login', { ip, headers: extra, body: { email: `nobody-${crypto.randomUUID()}@example.com`, password: 'x' } });
  const forwarded = (browser, secret = DASHBOARD_SECRET) => ({ 'x-client-ip': browser, 'x-dashboard-secret': secret });

  for (let i = 0; i < PUBLIC_LIMIT; i++) assert.equal((await login(dashboard, forwarded(browserA))).status, 401);
  assert.equal((await login(dashboard, forwarded(browserA))).status, 429);
  // Another browser behind the same dashboard has its own bucket, and the dashboard's own is untouched.
  assert.equal((await login(dashboard, forwarded(browserB))).status, 401);
  assert.equal((await login(dashboard)).status, 401);

  // browserA itself cannot escape its full bucket by claiming another IP without the secret.
  const fresh = randomIp();
  assert.equal((await login(browserA, forwarded(fresh, 'not-the-dashboard-secret-0123456789'))).status, 429);
  assert.equal((await login(browserA, { 'x-client-ip': fresh })).status, 429);
});
