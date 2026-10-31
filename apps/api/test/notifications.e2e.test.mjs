// Real queue, worker and Redis; only the outside world (Resend, Google OAuth, FCM) is stubbed.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, beforeEach, test } from 'node:test';
import { importSPKI, jwtVerify } from 'jose';
import { MAX_DEVICES_PER_USER } from '../dist/optional/push/push-devices.controller.js';
import { cleanup, db, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

// Fast retries so the dead-letter tests take milliseconds.
process.env.JOB_ATTEMPTS = '2';
process.env.JOB_BACKOFF_MS = '10';

const EXTERNAL = /^https:\/\/(api\.resend\.com|oauth2\.googleapis\.com|fcm\.googleapis\.com)\//;
const calls = [];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const succeed = (c) => (c.url.includes('oauth2') ? json({ access_token: 'fcm-access-token' }) : json({ id: 'ok' }));
let respond = succeed;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (!EXTERNAL.test(url)) return realFetch(input, init);
  const call = { url, headers: Object.fromEntries(new Headers(init.headers)), body: String(init.body) };
  calls.push(call);
  return respond(call);
};
const callsTo = (host) => calls.filter((c) => c.url.includes(host));

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SERVICE_ACCOUNT = {
  project_id: 'demo-project',
  client_email: 'fcm@demo.iam.gserviceaccount.com',
  private_key: keys.privateKey,
};

const tenants = {};
const tokens = {};
const users = {};
const apps = [];
let call, base, login, queue, dlq;

before(async () => {
  tenants.a = await seedTenant('notif-e2e-a', {
    admin: 'TenantAdmin',
    alice: 'User',
    carol: 'User',
    auditor: 'Auditor',
    root: 'SuperAdmin',
  });
  tenants.b = await seedTenant('notif-e2e-b', { admin: 'TenantAdmin', bob: 'User' });
  for (const u of await db.user.findMany({ where: { tenantId: { in: [tenants.a, tenants.b] } } })) {
    users[u.email.split('@')[0]] = u.id;
  }
  const started = await startApp();
  apps.push(started.app);
  ({ call, base, login } = started);
  tokens.adminA = await started.login(tenants.a, 'admin@example.com');
  tokens.alice = await started.login(tenants.a, 'alice@example.com');
  tokens.auditor = await started.login(tenants.a, 'auditor@example.com');
  tokens.adminB = await started.login(tenants.b, 'admin@example.com');

  const put = (provider, config) => call('PUT', `/integrations/${provider}`, { token: tokens.adminA, body: { config } });
  assert.equal((await put('resend', { apiKey: 're_tenant_a', from: 'Acme <no-reply@acme.test>' })).status, 200);
  assert.equal((await put('fcm', { serviceAccount: JSON.stringify(SERVICE_ACCOUNT) })).status, 200);
  const device = await call('POST', '/push/devices', { token: tokens.alice, body: { token: 'device-alice' } });
  assert.equal(device.status, 204);

  queue = testQueue('notifications');
  dlq = testQueue('notifications-dlq');
});

after(async () => {
  await queue?.close();
  await dlq?.close();
  await cleanup(apps, Object.values(tenants));
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls.length = 0;
  respond = succeed;
});

const notifyAlice = (overrides = {}) =>
  call('POST', '/notifications', {
    token: tokens.adminA,
    body: { userId: users.alice, title: 'Hi', body: 'Welcome aboard', ...overrides },
  });

test('delivers on every configured channel with the tenant’s own secrets, loaded by the worker', async () => {
  const res = await notifyAlice({ data: { orderId: '42' } });
  assert.equal(res.status, 202);
  const result = await res.json();
  assert.deepEqual({ ...result, queued: result.queued.sort() }, { queued: ['email', 'push'], realtime: true });
  await waitFor(() => callsTo('api.resend.com').length === 1 && callsTo('fcm.googleapis.com').length === 1);

  const [email] = callsTo('api.resend.com');
  assert.equal(email.headers.authorization, 'Bearer re_tenant_a');
  assert.ok(email.headers['idempotency-key'], 'retries must reuse an idempotency key');
  assert.deepEqual(JSON.parse(email.body), {
    from: 'Acme <no-reply@acme.test>',
    to: ['alice@example.com'],
    subject: 'Hi',
    text: 'Welcome aboard',
  });

  // The OAuth assertion is signed with the tenant's service-account key.
  const [oauth] = callsTo('oauth2.googleapis.com');
  const assertion = new URLSearchParams(oauth.body).get('assertion');
  const { payload } = await jwtVerify(assertion, await importSPKI(keys.publicKey, 'RS256'), {
    issuer: SERVICE_ACCOUNT.client_email,
    audience: 'https://oauth2.googleapis.com/token',
  });
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');

  const [push] = callsTo('fcm.googleapis.com');
  assert.match(push.url, /\/v1\/projects\/demo-project\/messages:send$/);
  assert.equal(push.headers.authorization, 'Bearer fcm-access-token');
  assert.deepEqual(JSON.parse(push.body).message, {
    token: 'device-alice',
    notification: { title: 'Hi', body: 'Welcome aboard' },
    data: { orderId: '42' },
  });

  // Job payloads never carry secrets.
  for (const job of await queue.getJobs(['completed'])) {
    assert.doesNotMatch(JSON.stringify(job.data), /re_tenant_a|PRIVATE KEY/);
  }
});

test('a tenant without configured channels gets real-time only, and never another tenant’s secrets', async () => {
  const res = await call('POST', '/notifications', {
    token: tokens.adminB,
    body: { userId: users.bob, title: 'Hi', body: 'B' },
  });
  assert.deepEqual(await res.json(), { queued: [], realtime: true });
  await sleep(300);
  assert.equal(calls.length, 0);
});

test('only a tenant’s own admins send, and only to users of that tenant', async () => {
  assert.equal((await call('POST', '/notifications', { token: tokens.adminA, body: { userId: users.bob, title: 'x', body: 'x' } })).status, 404);
  assert.equal((await call('POST', '/notifications', { token: tokens.alice, body: { userId: users.alice, title: 'x', body: 'x' } })).status, 403);
  assert.equal((await call('POST', '/notifications', { token: tokens.adminA, body: { userId: users.alice } })).status, 400);

  // SuperAdmin manages tenants and their users, not their messaging: refused in its own tenant and via X-Tenant-Id.
  const root = await login(tenants.a, 'root@example.com');
  const message = { userId: users.alice, title: 'x', body: 'x' };
  assert.equal((await call('POST', '/notifications', { token: root, body: message })).status, 403);
  const bob = { userId: users.bob, title: 'x', body: 'x' };
  assert.equal((await call('POST', '/notifications', { token: root, tenant: tenants.b, body: bob })).status, 403);
});

test('permanent failures go straight to the DLQ; transient ones are retried first', async () => {
  const before = await dlq.count();
  respond = (c) => (c.url.includes('resend') ? json({ message: 'The from address is not verified' }, 422) : succeed(c));
  await notifyAlice();
  await waitFor(async () => (await dlq.count()) === before + 1);

  respond = (c) => (c.url.includes('resend') ? json({ message: 'down' }, 503) : succeed(c));
  await notifyAlice();
  await waitFor(async () => (await dlq.count()) === before + 2);

  const records = (await dlq.getWaiting()).map((j) => j.data).sort((x, y) => x.failedAt.localeCompare(y.failedAt));
  const [permanent, transient] = records.slice(-2);
  assert.equal(permanent.jobName, 'email');
  assert.equal(permanent.attemptsMade, 1, 'a 422 must not be retried');
  assert.match(permanent.failedReason, /Resend answered 422/);
  assert.equal(transient.attemptsMade, 2, 'a 503 is retried until JOB_ATTEMPTS');
  assert.match(transient.failedReason, /Resend answered 503/);
  for (const r of [permanent, transient]) {
    assert.equal(r.payload.tenantId, tenants.a);
    assert.doesNotMatch(JSON.stringify(r), /re_tenant_a/);
  }
  // Dead-lettered jobs leave the main queue's failed set.
  await waitFor(async () => (await queue.getFailedCount()) === 0);
});

test('dead FCM device tokens are forgotten without failing the job', async () => {
  await call('POST', '/push/devices', { token: tokens.alice, body: { token: 'device-dead' } });
  respond = (c) =>
    c.url.includes('fcm.googleapis') && JSON.parse(c.body).message.token === 'device-dead'
      ? json({ error: { status: 'NOT_FOUND', message: 'UNREGISTERED' } }, 404)
      : succeed(c);
  const dlqBefore = await dlq.count();
  await notifyAlice();
  await waitFor(async () => (await db.pushDevice.count({ where: { tenantId: tenants.a, token: 'device-dead' } })) === 0);
  assert.equal(await db.pushDevice.count({ where: { tenantId: tenants.a, token: 'device-alice' } }), 1);
  await sleep(200);
  assert.equal(await dlq.count(), dlqBefore);
});

test('a 400 about the message keeps every device; a 400 about the token drops only that device', async () => {
  const fcmError = (message, details = []) =>
    json({ error: { code: 400, message, status: 'INVALID_ARGUMENT', details } }, 400);
  const dlqBefore = await dlq.count();

  // Payload problem: nothing is the devices' fault.
  respond = (c) =>
    c.url.includes('fcm.googleapis')
      ? fcmError('Message is too big', [
          { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message' }] },
        ])
      : succeed(c);
  await notifyAlice();
  await waitFor(async () => (await dlq.count()) === dlqBefore + 1);
  assert.equal(await db.pushDevice.count({ where: { tenantId: tenants.a, token: 'device-alice' } }), 1);

  // Token problem: only that device goes.
  await call('POST', '/push/devices', { token: tokens.alice, body: { token: 'device-bad-token' } });
  respond = (c) =>
    c.url.includes('fcm.googleapis') && JSON.parse(c.body).message.token === 'device-bad-token'
      ? fcmError('The registration token is not a valid FCM registration token')
      : succeed(c);
  await notifyAlice();
  await waitFor(async () => (await db.pushDevice.count({ where: { tenantId: tenants.a, token: 'device-bad-token' } })) === 0);
  assert.equal(await db.pushDevice.count({ where: { tenantId: tenants.a, token: 'device-alice' } }), 1);
});

test('data that FCM would reject is refused at the API', async () => {
  for (const data of [{ from: 'billing' }, { 'google.x': '1' }, { big: 'x'.repeat(1024), more: 'y' }]) {
    assert.equal((await notifyAlice({ data })).status, 400, JSON.stringify(Object.keys(data)));
  }
});

test('push devices: users only, removable by their owner', async () => {
  assert.equal((await call('POST', '/push/devices', { token: tokens.auditor, body: { token: 'aud' } })).status, 403);
  await call('POST', '/push/devices', { token: tokens.alice, body: { token: 'device-temp' } });
  assert.equal((await call('DELETE', '/push/devices/device-temp', { token: tokens.alice })).status, 204);
  assert.equal(await db.pushDevice.count({ where: { token: 'device-temp' } }), 0);
});

test('push devices: another tenant registering the same token leaves this tenant’s row alone', async () => {
  await call('POST', '/push/devices', { token: tokens.alice, body: { token: 'device-shared' } });
  assert.equal((await call('POST', '/push/devices', { token: tokens.adminB, body: { token: 'device-shared' } })).status, 204);
  const rows = await db.pushDevice.findMany({ where: { token: 'device-shared' } });
  assert.deepEqual(rows.map((r) => r.tenantId).sort(), [tenants.a, tenants.b].sort());
  assert.equal((await call('DELETE', '/push/devices/device-shared', { token: tokens.adminB })).status, 204);
  assert.equal((await db.pushDevice.findFirstOrThrow({ where: { token: 'device-shared' } })).tenantId, tenants.a);
  await db.pushDevice.deleteMany({ where: { tenantId: tenants.a, token: 'device-shared' } });
});

test('push devices: past the cap the oldest goes, and a device registered again counts as new', async () => {
  const userId = (await db.user.findFirstOrThrow({ where: { tenantId: tenants.b, email: 'admin@example.com' } })).id;
  const register = (name) => call('POST', '/push/devices', { token: tokens.adminB, body: { token: name } });
  for (let i = 0; i < MAX_DEVICES_PER_USER; i++) assert.equal((await register(`cap-${i}`)).status, 204);
  await register('cap-0');
  await register('cap-new');
  const tokensLeft = (await db.pushDevice.findMany({ where: { tenantId: tenants.b, userId } })).map((d) => d.token);
  assert.equal(tokensLeft.length, MAX_DEVICES_PER_USER);
  assert.ok(tokensLeft.includes('cap-0') && tokensLeft.includes('cap-new'));
  assert.ok(!tokensLeft.includes('cap-1'));
});

async function finished(job) {
  await waitFor(async () => (await job.getState()) === 'completed');
  return (await queue.getJob(job.id)).returnvalue;
}

test('graceful degradation: a missing module or a removed config is a skip, not a failure', async () => {
  const notification = { userId: users.alice, title: 'x', body: 'x' };
  const ghost = await queue.add('ghost', { tenantId: tenants.a, channel: 'ghost', notification });
  assert.deepEqual(await finished(ghost), { status: 'skipped', reason: 'channel "ghost" is not installed' });

  const disabled = await call('PUT', '/integrations/resend', {
    token: tokens.adminA,
    body: { config: { apiKey: 're_tenant_a', from: 'Acme <no-reply@acme.test>' }, enabled: false },
  });
  assert.equal(disabled.status, 200);
  // Queued before the change: the worker re-checks and skips.
  const stale = await queue.add('email', { tenantId: tenants.a, channel: 'email', notification });
  assert.deepEqual(await finished(stale), { status: 'skipped', reason: '"resend" is not configured or disabled' });
  // And new notifications no longer queue it.
  assert.deepEqual((await (await notifyAlice()).json()).queued, ['push']);
  assert.equal(callsTo('api.resend.com').length, 0);
});

test('with no channel modules installed, notifications are real-time only', async () => {
  const bare = await startApp({ optionalModulesDir: 'no-optional-modules-here' });
  apps.push(bare.app);
  const token = await bare.login(tenants.a, 'admin@example.com');
  const res = await bare.call('POST', '/notifications', { token, body: { userId: users.alice, title: 'x', body: 'x' } });
  assert.deepEqual(await res.json(), { queued: [], realtime: true });
});

// Reads SSE blocks until one of `type` arrives; returns its data (objects are sent as JSON, strings as is).
async function nextEvent(reader, type, timeoutMs) {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
    if (!chunk || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const block of buffer.split('\n\n')) {
      if (!new RegExp(`^event: ${type}$`, 'm').test(block)) continue;
      const data = /^data: (.*)$/m.exec(block)[1];
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
  }
  return null;
}

test('real-time events reach the user on any API instance, through Redis Pub/Sub', async () => {
  const second = await startApp();
  apps.push(second.app);
  const adminOnSecond = await second.login(tenants.a, 'admin@example.com');

  const stream = await fetch(`${base}/notifications/stream`, { headers: { authorization: `Bearer ${tokens.alice}` } });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  try {
    // Sent through the other instance; repeated until it arrives, since subscribing is asynchronous.
    let event = null;
    for (let attempt = 0; attempt < 10 && !event; attempt++) {
      await second.call('POST', '/notifications', {
        token: adminOnSecond,
        body: { userId: users.alice, title: 'Live', body: 'from instance 2' },
      });
      event = await nextEvent(reader, 'notification', 500);
    }
    assert.deepEqual(event, { userId: users.alice, title: 'Live', body: 'from instance 2' });
  } finally {
    await reader.cancel();
  }
});

test('a user over 5 open streams gets the oldest one closed with a "closed" event', async () => {
  const started = await startApp();
  apps.push(started.app);
  const token = await started.login(tenants.a, 'carol@example.com');
  const open = () =>
    fetch(`${started.base}/notifications/stream`, { headers: { authorization: `Bearer ${token}` } });

  const readers = [];
  try {
    for (let i = 0; i < 5; i++) readers.push((await open()).body.getReader());
    const sixth = await open();
    assert.equal(sixth.status, 200, 'the newest stream is accepted, not refused');
    readers.push(sixth.body.getReader());

    // The oldest is told why, then its response ends.
    assert.equal(await nextEvent(readers[0], 'closed', 2000), 'Too many open streams: replaced by a newer one');
    const end = await Promise.race([readers[0].read(), sleep(2000).then(() => ({ timeout: true }))]);
    assert.equal(end.done, true, 'the oldest stream must end');
    // The second oldest is still open: it gets no "closed" event.
    assert.equal(await nextEvent(readers[1], 'closed', 300), null);
  } finally {
    for (const reader of readers) await reader.cancel().catch(() => {});
  }
});

test('shutdown does not wait for open streams', async () => {
  const started = await startApp();
  const token = await started.login(tenants.a, 'carol@example.com');
  const stream = await fetch(`${started.base}/notifications/stream`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(stream.status, 200);
  const closed = await Promise.race([started.app.close().then(() => 'closed'), sleep(3000).then(() => 'timeout')]);
  assert.equal(closed, 'closed');
  await stream.body.cancel().catch(() => {});
});

test('a stream is refused with a real status before it starts, e.g. an unknown X-Tenant-Id', async () => {
  const token = await login(tenants.a, 'root@example.com');
  const res = await fetch(`${base}/notifications/stream`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-id': crypto.randomUUID() },
  });
  assert.equal(res.status, 404);
  await res.body?.cancel();
});

test('only users can open a stream', async () => {
  const { key } = await (await call('POST', '/api-keys', { token: tokens.adminA, body: { name: 'sse' } })).json();
  const res = await fetch(`${base}/notifications/stream`, { headers: { 'x-api-key': key } });
  assert.equal(res.status, 403);
});
