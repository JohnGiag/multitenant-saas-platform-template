// Dead-letter recovery and the DLQ cap, against real Redis. Only Resend is stubbed.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Worker } from 'bullmq';
import { cleanup, db, QUEUE_CONNECTION, QUEUE_PREFIX, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

process.env.JOB_ATTEMPTS = '1';
process.env.DLQ_MAX_ENTRIES = '2';

// Every email fails permanently: an unverified sender.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  String(input).startsWith('https://api.resend.com/')
    ? Promise.resolve(new Response('{"message":"sender not verified"}', { status: 422 }))
    : realFetch(input, init);

let tenantId, aliceId, queue, dlq, started;
const apps = [];

before(async () => {
  tenantId = await seedTenant('jobs-e2e', { admin: 'TenantAdmin', alice: 'User' });
  aliceId = (await db.user.findFirstOrThrow({ where: { tenantId, email: 'alice@example.com' } })).id;
  queue = testQueue('notifications');
  dlq = testQueue('notifications-dlq');
});

after(async () => {
  await queue.close();
  await dlq.close();
  await cleanup(apps, [tenantId]);
  globalThis.fetch = realFetch;
});

const notification = (title) => ({ userId: aliceId, title, body: 'x' });

test('the startup sweep dead-letters failed jobs that never reached the DLQ', async () => {
  // A job that failed while no dead-lettering worker was running (e.g. a crash mid-write).
  const crashing = new Worker(
    'notifications',
    async () => {
      throw new Error('crashed before dead-lettering');
    },
    { connection: QUEUE_CONNECTION, prefix: QUEUE_PREFIX },
  );
  const job = await queue.add('email', { tenantId, channel: 'email', notification: notification('lost') }, { attempts: 1 });
  await waitFor(async () => (await queue.getFailedCount()) === 1);
  await crashing.close();
  assert.equal(await dlq.count(), 0);

  started = await startApp();
  apps.push(started.app);
  await waitFor(async () => (await dlq.count()) === 1 && (await queue.getFailedCount()) === 0);
  const [record] = (await dlq.getWaiting()).map((j) => j.data);
  assert.equal(record.originalJobId, job.id);
  assert.equal(record.failedReason, 'crashed before dead-lettering');
});

test('the DLQ keeps only its newest DLQ_MAX_ENTRIES entries', async () => {
  const { call, login } = started;
  const token = await login(tenantId, 'admin@example.com');
  const configured = await call('PUT', '/integrations/resend', {
    token,
    body: { config: { apiKey: 're_x', from: 'Acme <a@acme.test>' } },
  });
  assert.equal(configured.status, 200);

  // One at a time, so the order of failure is the order of sending. With the sweep's "lost" entry
  // already there, the cap of 2 is crossed twice.
  for (const title of ['first', 'second', 'third']) {
    await call('POST', '/notifications', { token, body: notification(title) });
    await waitFor(async () => (await dlq.getWaiting()).some((j) => j.data.payload.notification.title === title));
  }
  await waitFor(async () => (await dlq.count()) === 2);
  const titles = (await dlq.getWaiting()).map((j) => j.data.payload.notification.title).sort();
  assert.deepEqual(titles, ['second', 'third']);
});
