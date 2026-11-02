// Usage metering against real Postgres and Redis, with a fixture module declaring the meters. No billing installed:
// counting and quotas work without it.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import { TenantEvents } from '../dist/modules/events/domain/tenant-events.js';
import { UsageMeter } from '../dist/modules/usage/domain/usage-meter.js';
import { crossedThresholds, hourStart, isRefused, nextPeriodStart, periodStart } from '../dist/modules/usage/domain/usage-policy.js';
import { UsageFlush } from '../dist/modules/usage/infrastructure/usage-flush.js';
import { cleanup, db, FIXTURES, QUEUE_CONNECTION, seedTenant, startApp, waitFor } from './helpers.mjs';

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!String(input).startsWith('https://api.resend.com/')) return realFetch(input, init);
  emails.push(JSON.parse(String(init.body)));
  return Promise.resolve(new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 }));
};

const tenants = {};
const tokens = {};
const published = [];
const redis = new Redis(QUEUE_CONNECTION.url);
let app, call, login;

before(async () => {
  tenants.platform = await seedTenant('usage-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('usage-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('usage-e2e-b', { admin: 'TenantAdmin' });
  tenants.pro = await seedTenant('usage-e2e-pro', { admin: 'TenantAdmin' });
  await db.tenant.update({ where: { id: tenants.pro }, data: { tier: 'pro' } });
  ({ app, call, login } = await startApp({ optionalModulesDir: join(FIXTURES, 'optional-metered') }));
  app.get(TenantEvents).subscribe(async (event) => void published.push(event));
  tokens.admin = await login(tenants.a, 'admin@example.com');
  tokens.user = await login(tenants.a, 'user@example.com');
  tokens.auditor = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
  tokens.adminPro = await login(tenants.pro, 'admin@example.com');
  tokens.super = await login(tenants.platform, 'super@example.com');
});

after(async () => {
  redis.disconnect();
  globalThis.fetch = realFetch;
  await cleanup(app, Object.values(tenants));
});

const spend = (token, meter) => call('POST', `/metered/${meter}`, { token });
const usageOf = async (token, meter) => (await (await call('GET', '/usage', { token })).json()).meters.find((m) => m.meter === meter);
const flush = () => app.get(UsageFlush, { strict: false }).flush();

test('periods, thresholds and limits', () => {
  const now = new Date('2026-11-15T10:45:12.000Z');
  assert.equal(hourStart(now).toISOString(), '2026-11-15T10:00:00.000Z');
  assert.equal(periodStart(now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextPeriodStart(new Date('2026-12-31T23:59:59.000Z')).toISOString(), '2027-01-01T00:00:00.000Z');

  assert.deepEqual(crossedThresholds(79, 80, 100), [80]);
  assert.deepEqual(crossedThresholds(80, 81, 100), []);
  assert.deepEqual(crossedThresholds(99, 100, 100), [100]);
  assert.deepEqual(crossedThresholds(0, 500, 100), [80, 100], 'one big addition crosses both');

  assert.equal(isRefused(3, { limit: 3, hard: true }), true);
  assert.equal(isRefused(2, { limit: 3, hard: true }), false);
  assert.equal(isRefused(99, { limit: 3, hard: false }), false, 'a soft limit never refuses');
  assert.equal(isRefused(99, null), false);
});

test('a tenant over a hard quota is refused with a reason, and the usage route shows it', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await spend(tokens.admin, 'hard')).status, 201);
  const refused = await spend(tokens.admin, 'hard');
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) > 0);
  const body = await refused.json();
  assert.deepEqual({ code: body.code, meter: body.meter }, { code: 'quota_exceeded', meter: 'hard_units' });

  const usage = await usageOf(tokens.auditor, 'hard_units');
  assert.deepEqual({ used: usage.used, limit: usage.limit, refused: usage.refused }, { used: 3, limit: 3, refused: true });
  assert.equal(usage.periodStart, periodStart(new Date()).toISOString());
});

test('quotas belong to the tenant and its tier', async () => {
  assert.equal((await spend(tokens.adminB, 'hard')).status, 201, "tenant A's usage does not count against tenant B");
  assert.equal((await usageOf(tokens.adminB, 'hard_units')).used, 1);
  assert.equal((await usageOf(tokens.adminPro, 'hard_units')).limit, 100);
  assert.equal((await usageOf(tokens.adminPro, 'soft_units')).limit, null, 'no limit on this tier');
});

test('a soft quota warns at 80% and 100%, once each, by email to admins and as an event, and refuses nothing', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await spend(tokens.admin, 'soft')).status, 201);

  const alerts = () => published.filter((e) => e.type === 'usage.threshold_reached' && e.tenantId === tenants.a && e.data.meter === 'soft_units');
  const mails = () => emails.filter((mail) => mail.subject.includes('soft_units'));
  await waitFor(() => alerts().length === 2 && mails().length === 2);
  assert.deepEqual(alerts().map((e) => e.data.percent).sort((a, b) => a - b), [80, 100]);
  assert.deepEqual(alerts()[0].data.limit, 10);
  assert.ok(mails().every((mail) => JSON.stringify(mail.to).includes('admin@example.com')));
  assert.ok(mails().some((mail) => mail.subject.includes('80%')));
  assert.equal((await usageOf(tokens.admin, 'soft_units')).refused, false);
});

test('a flush keeps the counts in the database, so a lost Redis costs minutes, not a month', async () => {
  await spend(tokens.adminB, 'soft');
  await spend(tokens.adminB, 'soft');
  await flush();
  const where = { tenantId: tenants.b, meter: 'soft_units' };
  const [record] = await db.usageRecord.findMany({ where });
  assert.equal(record.quantity, 2);
  assert.equal(record.periodStart.toISOString(), hourStart(new Date()).toISOString());

  await flush();
  assert.equal(await db.usageRecord.count({ where }), 1, 'flushing twice changes nothing');

  // Redis loses everything about this tenant.
  const keys = await redis.keys(`usage:*:${tenants.b}:soft_units:*`);
  assert.ok(keys.length >= 2);
  await redis.del(...keys);
  assert.equal((await usageOf(tokens.adminB, 'soft_units')).used, 2, 'the month comes back from the stored hours');

  await spend(tokens.adminB, 'soft');
  await flush();
  assert.equal((await db.usageRecord.findFirstOrThrow({ where })).quantity, 2, 'a restarted counter never lowers what was stored');
  assert.equal((await usageOf(tokens.adminB, 'soft_units')).used, 3);
});

test('flushed records reach listeners under their own tenant, while unreported', async () => {
  const seen = [];
  app.get(UsageMeter, { strict: false }).onFlushed(async (record) => void seen.push(record));
  await spend(tokens.adminPro, 'soft');
  await flush();
  const mine = seen.filter((record) => record.tenantId === tenants.pro);
  assert.equal(mine.length, 1);
  assert.deepEqual({ meter: mine[0].meter, quantity: mine[0].quantity, reported: mine[0].reportedQuantity }, { meter: 'soft_units', quantity: 1, reported: 0 });
});

test('a counter from a closed hour is flushed for the last time', async () => {
  const hourMs = hourStart(new Date()).getTime() - 3_600_000;
  await redis.set(`usage:hour:${tenants.pro}:hard_units:${hourMs}`, 7, 'EX', 60);
  await redis.sadd('usage:active', `${tenants.pro}:hard_units:${hourMs}`);
  await flush();
  assert.equal((await db.usageRecord.findFirstOrThrow({ where: { tenantId: tenants.pro, meter: 'hard_units' } })).quantity, 7);
  assert.equal(await redis.sismember('usage:active', `${tenants.pro}:hard_units:${hourMs}`), 0);
});

test('admins and Auditors read usage; members and SuperAdmin do not', async () => {
  assert.equal((await call('GET', '/usage', { token: tokens.user })).status, 403);
  assert.equal((await call('GET', '/usage', { token: tokens.super, tenant: tenants.a })).status, 403);
});

test('a meter nobody declared is a bug, not a quiet zero', async () => {
  await assert.rejects(app.get(UsageMeter, { strict: false }).record(tenants.a, 'no_such_meter'), /not declared/);
});

test('test mode counts apart from live usage, under the live tier', async () => {
  const headers = { 'x-sandbox': 'true' };
  const before = (await usageOf(tokens.adminPro, 'soft_units')).used;
  assert.equal((await call('POST', '/metered/soft', { token: tokens.adminPro, headers })).status, 201);
  assert.equal((await usageOf(tokens.adminPro, 'soft_units')).used, before);
  const sandbox = (await (await call('GET', '/usage', { token: tokens.adminPro, headers })).json()).meters.find((m) => m.meter === 'hard_units');
  assert.equal(sandbox.limit, 100);
});

test('deleting a tenant erases its records and counters', async () => {
  const doomed = await seedTenant('usage-e2e-doomed', { admin: 'TenantAdmin' });
  const token = await login(doomed, 'admin@example.com');
  await spend(token, 'soft');
  await flush();
  assert.equal(await db.usageRecord.count({ where: { tenantId: doomed } }), 1);
  await spend(token, 'soft');

  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);
  assert.equal(await db.usageRecord.count({ where: { tenantId: doomed } }), 0);
  assert.deepEqual(await redis.keys(`usage:*:${doomed}:*`), []);
  assert.ok(!(await redis.smembers('usage:active')).some((member) => member.startsWith(doomed)));
  await flush();
});
