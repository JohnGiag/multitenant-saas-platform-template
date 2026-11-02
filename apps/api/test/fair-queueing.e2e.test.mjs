// A flood from one tenant slows only the tenants sharing its partition, against real Redis and a real receiver.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'bullmq';
import { partitionOf } from '../dist/modules/jobs/job-config.js';
import { cleanup, db, QUEUE_CONNECTION, QUEUE_PREFIX, seedTenant, seedUser, startApp, testQueue, waitFor, WEBHOOK_QUEUES } from './helpers.mjs';

process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';

const received = [];
const receiver = createServer((req, res) => {
  received.push(req.url);
  // The noisy tenant's endpoint is slow, like a real one under load.
  setTimeout(() => res.end(), req.url === '/noisy' ? 200 : 0);
});

const tenants = {};
const queues = WEBHOOK_QUEUES.map(testQueue);
const deadLetters = WEBHOOK_QUEUES.map((name) => testQueue(`${name}-dlq`));
const partition = (tenantId) => partitionOf(tenantId, 8);
const payload = (tenantId) => ({ id: `evt_${crypto.randomUUID()}`, type: 'webhook.test', tenantId, timestamp: new Date().toISOString(), data: {} });
let app, call, login, base;

// A job that failed while no dead-lettering worker was running, on a queue it was routed to.
async function failedBeforeStartup(index) {
  const crashing = new Worker(
    WEBHOOK_QUEUES[index],
    async () => {
      throw new Error('crashed before dead-lettering');
    },
    { connection: QUEUE_CONNECTION, prefix: QUEUE_PREFIX },
  );
  await queues[index].add('webhook.test', { tenantId: tenants.quiet, endpointId: crypto.randomUUID(), payload: payload(tenants.quiet) }, { attempts: 1 });
  await waitFor(async () => (await queues[index].getFailedCount()) === 1);
  await crashing.close();
}

before(async () => {
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${receiver.address().port}`;
  tenants.platform = await seedTenant('fair-e2e-platform', { super: 'SuperAdmin' });
  tenants.noisy = await seedTenant('fair-e2e-noisy', { admin: 'TenantAdmin' });
  do tenants.quiet = await seedTenant('fair-e2e-quiet');
  while (partition(tenants.quiet) === partition(tenants.noisy) && (await db.tenant.delete({ where: { id: tenants.quiet } })));
  await seedUser(tenants.quiet, { email: 'admin@example.com', role: 'TenantAdmin' });

  for (const index of [0, 7]) await failedBeforeStartup(index);
  ({ app, call, login } = await startApp());
});

after(async () => {
  await app?.close();
  receiver.close();
  await Promise.all([...queues, ...deadLetters].map((queue) => queue.close()));
  await cleanup([], Object.values(tenants));
});

async function endpoint(tenantId, path) {
  const token = await login(tenantId, 'admin@example.com');
  const res = await call('POST', '/webhooks', { token, body: { url: `${base}${path}` } });
  assert.equal(res.status, 201);
  return { token, id: (await res.json()).id };
}

test('the startup sweep covers every partition', async () => {
  for (const index of [0, 7]) {
    await waitFor(async () => (await deadLetters[index].count()) === 1 && (await queues[index].getFailedCount()) === 0);
    const [{ data }] = await deadLetters[index].getWaiting();
    assert.equal(data.originalQueue, WEBHOOK_QUEUES[index]);
    await deadLetters[index].obliterate({ force: true });
  }
});

test("a backlog of 10,000 jobs from one tenant does not delay another tenant's job in another partition", async () => {
  const noisy = await endpoint(tenants.noisy, '/noisy');
  const quiet = await endpoint(tenants.quiet, '/quiet');
  const flooded = queues[partition(tenants.noisy)];
  const job = () => ({ name: 'webhook.test', data: { tenantId: tenants.noisy, endpointId: noisy.id, payload: payload(tenants.noisy) }, opts: { attempts: 1 } });
  for (let i = 0; i < 10; i++) await flooded.addBulk(Array.from({ length: 1000 }, job));
  await waitFor(() => received.includes('/noisy'));

  const startedAt = Date.now();
  assert.equal((await call('POST', `/webhooks/${quiet.id}/test`, { token: quiet.token })).status, 202);
  await waitFor(() => received.includes('/quiet'), 5000);
  const tookMs = Date.now() - startedAt;

  assert.ok(tookMs < 2000, `took ${tookMs} ms`);
  assert.ok((await flooded.getWaitingCount()) > 9000, 'the flood was still there');
  await flooded.obliterate({ force: true });
});

test('deleting a tenant drops its jobs from every partition, and nobody else\'s', async () => {
  const doomed = await seedTenant('fair-e2e-doomed');
  const token = await login(tenants.platform, 'super@example.com');
  const delayed = (tenantId) => ({ tenantId, endpointId: crypto.randomUUID(), payload: payload(tenantId) });
  for (const queue of queues) await queue.add('webhook.test', delayed(doomed), { delay: 3_600_000 });
  await queues[0].add('webhook.test', delayed(tenants.quiet), { delay: 3_600_000 });
  for (const dlq of deadLetters) await dlq.add('webhook.test', { payload: delayed(doomed) });

  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token })).status, 204);
  await sleep(100);
  const left = await Promise.all(queues.map((queue) => queue.getDelayed()));
  assert.deepEqual(left.flat().map((job) => job.data.tenantId), [tenants.quiet]);
  assert.deepEqual(await Promise.all(deadLetters.map((dlq) => dlq.count())), Array(8).fill(0));
});
