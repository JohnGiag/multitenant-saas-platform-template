// The outbox: events commit with their change, reach the tenant-events queue at least once, and run their listeners.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TenantEvents } from '../dist/modules/events/domain/tenant-events.js';
import { recordEvent } from '../dist/modules/events/infrastructure/outbox.js';
import { cleanup, db, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

// Retries in milliseconds, so running out of attempts does not take minutes.
process.env.JOB_BACKOFF_MS = '1';

const tenants = {};
const published = [];
const attempts = [];
// Event type -> how many more attempts should fail.
const failures = new Map();
let app, call, login, second, dlq;

before(async () => {
  tenants.platform = await seedTenant('outbox-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('outbox-e2e-a');
  tenants.b = await seedTenant('outbox-e2e-b');
  dlq = testQueue('tenant-events-dlq');
  ({ app, call, login } = await startApp());
  app.get(TenantEvents).subscribe(async (event) => {
    attempts.push(event);
    const left = failures.get(event.type) ?? 0;
    if (left === 0) return void published.push(event);
    failures.set(event.type, left - 1);
    throw new Error('listener down');
  });
});

after(async () => {
  await dlq.close();
  await cleanup([app, second?.app], Object.values(tenants));
});

const record = (tenantId, type, data) => db.$transaction((tx) => recordEvent(tx, tenantId, type, data));
const pending = (tenantId) => db.outboxEvent.count({ where: { tenantId } });
const seen = (type) => published.filter((e) => e.type === type);
const tried = (type) => attempts.filter((e) => e.type === type);

test('an event rolls back with the change it reports', async () => {
  await assert.rejects(
    db.$transaction(async (tx) => {
      await recordEvent(tx, tenants.a, 'test.rolled_back');
      throw new Error('the change failed');
    }),
    /the change failed/,
  );
  assert.equal(await pending(tenants.a), 0);
});

test('a delivered event reaches listeners as written, under its own tenant, and leaves the table', async () => {
  await record(tenants.a, 'test.delivered', { userId: 'a' });
  await record(tenants.b, 'test.delivered', { userId: 'b' });
  await waitFor(() => seen('test.delivered').length === 2);
  await waitFor(async () => (await pending(tenants.a)) + (await pending(tenants.b)) === 0);

  const dataOf = (tenantId) => seen('test.delivered').find((e) => e.tenantId === tenantId).data;
  assert.deepEqual(dataOf(tenants.a), { userId: 'a' });
  assert.deepEqual(dataOf(tenants.b), { userId: 'b' }, "one tenant's event never carries another's data");
  assert.ok(seen('test.delivered')[0].occurredAt instanceof Date);
});

test('a failing listener is retried with the same event id', async () => {
  failures.set('test.retried', 2);
  await record(tenants.a, 'test.retried');
  await waitFor(() => seen('test.retried').length === 1);
  assert.equal(tried('test.retried').length, 3);
  assert.equal(new Set(tried('test.retried').map((e) => e.id)).size, 1);
  assert.match(seen('test.retried')[0].id, /^evt_/);
});

test('an event whose listener keeps failing lands in the dead-letter queue, and the others still go through', async () => {
  failures.set('test.poison', Infinity);
  await record(tenants.a, 'test.poison', { userId: 'a' });
  await record(tenants.a, 'test.after_poison');
  await waitFor(() => seen('test.after_poison').length === 1);

  const dead = async () => (await dlq.getWaiting()).find((job) => job.data.payload.type === 'test.poison')?.data;
  await waitFor(dead);
  const entry = await dead();
  assert.equal(entry.attemptsMade, 10);
  assert.equal(entry.failedReason, 'listener down');
  assert.deepEqual({ tenantId: entry.payload.tenantId, data: entry.payload.data }, { tenantId: tenants.a, data: { userId: 'a' } });
  assert.equal(tried('test.poison').length, 10);
  assert.equal(await pending(tenants.a), 0);
});

test('several instances share the work: nothing is delivered twice, and a backlog larger than a batch drains', async () => {
  second = await startApp();
  second.app.get(TenantEvents).subscribe(async (event) => void published.push(event));
  const count = 120;
  await db.outboxEvent.createMany({ data: Array.from({ length: count }, () => ({ tenantId: tenants.b, type: 'test.shared', data: {} })) });
  await waitFor(() => seen('test.shared').length >= count);
  await waitFor(async () => (await pending(tenants.b)) === 0);
  assert.equal(new Set(seen('test.shared').map((e) => e.id)).size, count);
  assert.equal(seen('test.shared').length, count);
});

test('deleting a tenant erases its undelivered events', async () => {
  tenants.doomed = await seedTenant('outbox-e2e-doomed');
  const token = await login(tenants.platform, 'super@example.com');
  await db.outboxEvent.create({ data: { tenantId: tenants.doomed, type: 'test.doomed', data: {}, nextAttemptAt: new Date(Date.now() + 60_000) } });
  assert.equal((await call('DELETE', `/tenants/${tenants.doomed}`, { token })).status, 204);
  assert.equal(await pending(tenants.doomed), 0);
  delete tenants.doomed;
});
