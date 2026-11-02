// Runs in its own process: the app reaches Redis through a proxy, so the test can cut it off and bring it back.
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { generateApiKey, hashApiKeySecret } from '../dist/modules/auth/domain/api-key.js';
import { cleanup, db, QUEUE_CONNECTION, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

process.env.WEBHOOKS_ALLOW_PRIVATE = 'true';

const redis = new URL(QUEUE_CONNECTION.url);
const links = new Set();
const proxy = createServer((client) => {
  const upstream = connect(Number(redis.port), redis.hostname);
  for (const [from, to] of [[client, upstream], [upstream, client]]) {
    links.add(from);
    from.on('error', () => to.destroy());
    from.on('close', () => to.destroy());
    from.pipe(to);
  }
});
let proxyPort = 0;
const redisUp = () => new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
function redisDown() {
  proxy.close();
  for (const socket of links) socket.destroy();
  links.clear();
}

const received = [];
const receiver = createHttpServer((req, res) => {
  received.push(req.headers['webhook-id']);
  res.end();
});

let app, call, tenantId, adminKey;

before(async () => {
  await redisUp();
  proxyPort = proxy.address().port;
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  tenantId = await seedTenant('outbox-outage-e2e');
  const key = generateApiKey();
  await db.apiKey.create({ data: { tenantId, name: 'outage', role: 'TenantAdmin', scopes: ['read', 'write'], prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) } });
  adminKey = key.raw;
  process.env.REDIS_URL = `redis://127.0.0.1:${proxyPort}`;
  ({ app, call } = await startApp());
  const url = `http://127.0.0.1:${receiver.address().port}/hook`;
  assert.equal((await call('POST', '/webhooks', { apiKey: adminKey, body: { url, events: ['api_key.created'] } })).status, 201);
});

after(async () => {
  await app?.close();
  receiver.close();
  proxy.close();
  for (const name of ['webhooks', 'webhooks-dlq']) {
    const queue = testQueue(name);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  await cleanup([], [tenantId]);
});

test('an event committed during a Redis outage is delivered, once, after Redis returns', async () => {
  redisDown();
  const res = await call('POST', '/api-keys', { apiKey: adminKey, body: { name: 'during-outage' } });
  assert.equal(res.status, 201, 'the change does not wait for Redis');
  const { id } = await db.outboxEvent.findFirstOrThrow({ where: { tenantId, type: 'api_key.created' } });

  // Longer than a queue call waits, so the relay's attempt has failed by now.
  await sleep(3000);
  assert.ok(await db.outboxEvent.findUnique({ where: { id } }), 'still pending');
  assert.equal(received.length, 0);

  await redisUp();
  // The relay retries by itself, 30 seconds after the failure.
  await waitFor(async () => (await db.outboxEvent.count({ where: { id } })) === 0, 40_000);
  await waitFor(() => received.length > 0, 30_000);
  assert.equal(received[0], `evt_${id}`);
  await sleep(1000);
  assert.equal(received.length, 1, 'the attempt that timed out and the retry make one delivery');
});
