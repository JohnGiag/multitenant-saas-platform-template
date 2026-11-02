// The real server under the OTel preload, started the way production does (NODE_OPTIONS), sending to a fake OTLP
// receiver on this machine. Everything asserted here is what actually left the process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { cleanup, db, PASSWORD, seedTenant, seedUser, waitFor } from './helpers.mjs';

const PRELOAD = '--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import=./dist/telemetry.js';
const SECRETS = {
  query: 'query-secret-c1b6',
  path: 'path-secret-0f2a',
  webhook: 'webhook-token-9d3e',
  agent: 'agent-secret-77aa',
  ip: '203.0.113.77',
  password: 'wrong-password-5e1c',
};

// Every OTLP request, as received. JSON, so the tests can read it.
const received = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ path: req.url, body });
    // A webhook delivery that fails, to get a job failure into the logs.
    res.statusCode = req.url.startsWith('/hook') ? 500 : 200;
    res.setHeader('content-type', 'application/json');
    res.end('{}');
  });
});
let receiverUrl;

const freePort = () =>
  new Promise((resolve) => {
    const probe = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: String(port), WEBHOOKS_ALLOW_PRIVATE: 'true', ...env },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const base = `http://127.0.0.1:${port}/v1`;
  await waitFor(() => fetch(`${base}/health`).then((r) => r.ok, () => false), 30_000);
  return { child, exited, base };
}

const OTLP = { NODE_OPTIONS: PRELOAD, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' };
const clientHeaders = { 'content-type': 'application/json', 'x-forwarded-for': SECRETS.ip, 'user-agent': SECRETS.agent };

const sentTo = (prefix) => received.filter((r) => r.path.startsWith(prefix));
const signal = (name) => received.filter((r) => r.path === `/v1/${name}`).map((r) => JSON.parse(r.body));
const spans = () =>
  signal('traces').flatMap((p) => p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans.map((span) => ({ ...span, scope: s.scope.name })))));
const metrics = () => signal('metrics').flatMap((p) => p.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics)));
const logRecords = () => signal('logs').flatMap((p) => p.resourceLogs.flatMap((r) => r.scopeLogs.flatMap((s) => s.logRecords)));
const attribute = (item, key) => {
  const value = item.attributes?.find((a) => a.key === key)?.value;
  return value && Object.values(value)[0];
};
const dataPoints = (name) => metrics().filter((m) => m.name === name).flatMap((m) => (m.histogram ?? m.gauge ?? m.sum).dataPoints);

let tenantId, apiKeyId, email, server;

before(async () => {
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}`;
  tenantId = await seedTenant('telemetry-e2e');
  email = await seedUser(tenantId, { role: 'TenantAdmin' });

  server = await startServer({
    ...OTLP,
    OTEL_EXPORTER_OTLP_ENDPOINT: receiverUrl,
    OTEL_BSP_SCHEDULE_DELAY: '100',
    OTEL_METRIC_EXPORT_INTERVAL: '500',
    OTEL_METRIC_EXPORT_TIMEOUT: '400',
    TRUST_PROXY_HOPS: '1',
  });
  const { base } = server;
  const post = (path, body, headers = clientHeaders) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });

  assert.equal((await post('/auth/login', { tenantId, email, password: SECRETS.password })).status, 401);
  const login = await post('/auth/login', { tenantId, email, password: PASSWORD });
  assert.equal(login.status, 200);
  const first = await login.json();
  const auth = { ...clientHeaders, authorization: `Bearer ${first.accessToken}` };

  await fetch(`${base}/auth/me?probe=${SECRETS.query}`, { headers: auth });
  await fetch(`${base}/no-such-route/${SECRETS.path}`, { headers: auth });

  // Its receiver answers 500, and creating the key sends it an event: the failed job gets logged, and the delivery's
  // client span sees the tokenised URL.
  await post('/webhooks', { url: `${receiverUrl}/hook?token=${SECRETS.webhook}` }, auth);
  const created = await post('/api-keys', { name: 'telemetry' }, auth);
  assert.equal(created.status, 201);
  apiKeyId = (await created.json()).id;
  await fetch(`${base}/api-keys/${apiKeyId}`, { method: 'DELETE', headers: auth });

  const stream = await fetch(`${base}/notifications/stream`, { headers: auth });
  await stream.body.cancel();

  // A replayed refresh token: the warning is logged inside the request, so it carries the trace.
  const second = await (await post('/auth/refresh', { refreshToken: first.refreshToken })).json();
  await post('/auth/refresh', { refreshToken: second.refreshToken });
  await post('/auth/refresh', { refreshToken: first.refreshToken });

  await waitFor(() => spans().some((s) => s.name.startsWith('process ')) && received.some((r) => r.path.startsWith('/hook')));
  await waitFor(() => dataPoints('jobs.depth').length > 0 && logRecords().some((l) => /replayed/.test(l.body?.stringValue)));
  await waitFor(() => dataPoints('http.server.request.duration').some((p) => attribute(p, 'http.route') === '/v1/api-keys/:id'));
});

after(async () => {
  server?.child.kill('SIGKILL');
  receiver.close();
  await db.webhookEndpoint.deleteMany({ where: { tenantId } });
  await cleanup(undefined, [tenantId]);
});

test('no secret, address, email or user agent leaves the process, on any signal', () => {
  const everything = received.filter((r) => r.path.startsWith('/v1/')).map((r) => r.body).join('\n');
  assert.ok(everything.length > 10_000, 'too little telemetry received to prove anything');
  for (const [name, secret] of Object.entries(SECRETS)) assert.ok(!everything.includes(secret), `${name} was exported`);
  assert.ok(!everything.includes(PASSWORD), 'the password was exported');
  assert.ok(!everything.includes(email), 'the email was exported');
  for (const attribute of ['process.command_args', 'process.owner']) assert.ok(!everything.includes(attribute), `${attribute} was exported`);
});

test('spans name the route pattern, never the raw path', () => {
  assert.ok(spans().some((s) => attribute(s, 'http.route') === '/v1/api-keys/:id'), 'no span for DELETE /v1/api-keys/:id');
  assert.ok(!JSON.stringify(spans().filter((s) => s.kind === 2)).includes(apiKeyId), 'a server span carries the raw path');
});

test('a request is tagged with its tenant, on traces', () => {
  assert.ok(spans().some((s) => attribute(s, 'tenant.id') === tenantId));
});

test("a request's trace continues into its job, and through the database and Redis", () => {
  const request = spans().find((s) => s.name === 'POST /v1/api-keys');
  assert.ok(request, 'no span for POST /v1/api-keys');
  const trace = spans().filter((s) => s.traceId === request.traceId);
  assert.ok(trace.some((s) => /^process webhooks-\d$/.test(s.name)), 'the job is not in the trace of the request that queued it');
  assert.ok(trace.some((s) => s.scope === 'prisma'), 'no database span');
  assert.ok(trace.some((s) => s.scope.includes('ioredis')), 'no Redis span');
});

test('health probes and the SSE stream are not traced', () => {
  assert.ok(!spans().some((s) => /health|notifications\/stream/.test(s.name)));
});

test('logs arrive with their severity and the trace of their request', () => {
  const replay = logRecords().find((l) => /replayed/.test(l.body?.stringValue));
  assert.equal(replay.severityText, 'warn');
  assert.ok(/^[0-9a-f]{32}$/.test(replay.traceId), 'the log is not tied to a trace');
  assert.equal(attribute(replay, 'log.context'), 'LocalAuth');
});

test('metrics: request duration by route, queue depth with dead-letter queues, and runtime', async () => {
  assert.ok(dataPoints('http.server.request.duration').some((p) => attribute(p, 'http.route') === '/v1/api-keys/:id'));
  const depths = dataPoints('jobs.depth');
  assert.ok(depths.some((p) => /^webhooks-\d$/.test(attribute(p, 'queue')) && attribute(p, 'state') === 'waiting'));
  assert.ok(depths.some((p) => /^webhooks-\d-dlq$/.test(attribute(p, 'queue'))));
  assert.ok(metrics().some((m) => m.name.startsWith('nodejs.eventloop') || m.name.startsWith('v8js.')));
});

test('a rate-limited request is counted, without saying who', async () => {
  const token = await (await fetch(`${server.base}/auth/login`, {
    method: 'POST',
    headers: clientHeaders,
    body: JSON.stringify({ tenantId, email, password: PASSWORD }),
  })).json();
  const headers = { ...clientHeaders, authorization: `Bearer ${token.accessToken}` };
  let status;
  for (let i = 0; i < 200 && status !== 429; i++) ({ status } = await fetch(`${server.base}/auth/me`, { headers }));
  assert.equal(status, 429);
  await waitFor(() => dataPoints('rate_limit.rejected').some((p) => attribute(p, 'scope') === 'authenticated'));
});

test('no metric carries a tenant or a webhook host: labels would multiply with them', () => {
  const labels = new Set(metrics().flatMap((m) => (m.histogram ?? m.gauge ?? m.sum)?.dataPoints ?? []).flatMap((p) => p.attributes ?? []).map((a) => a.key));
  assert.ok(labels.has('http.route'));
  for (const label of ['tenant.id', 'tenant_id', 'server.address', 'url.full', 'client.address']) assert.ok(!labels.has(label), `${label} is a metric label`);
  assert.ok(!dataPoints('http.client.request.duration').some((p) => attribute(p, 'server.address')));
});

test('one signal to its own endpoint, with the others switched off', async () => {
  const { child, exited, base } = await startServer({
    ...OTLP,
    OTEL_EXPORTER_OTLP_ENDPOINT: `${receiverUrl}/others`,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${receiverUrl}/only/traces`,
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_BSP_SCHEDULE_DELAY: '100',
  });
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  await waitFor(() => sentTo('/only/traces').some((r) => r.body.includes('GET /v1/auth/me')));
  child.kill('SIGKILL');
  await exited;
  assert.deepEqual(sentTo('/others'), []);
});

test('without the preload nothing is sent, even with an endpoint configured', async () => {
  const { child, exited, base } = await startServer({ NODE_OPTIONS: '', OTEL_EXPORTER_OTLP_ENDPOINT: `${receiverUrl}/off` });
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  await sleep(300);
  child.kill('SIGKILL');
  await exited;
  assert.deepEqual(sentTo('/off'), []);
});

// Windows has no signals: kill() ends the process at once, so no handler runs (proven on Linux by CI, and by the image).
const signals = { skip: process.platform === 'win32' && 'Windows has no SIGTERM' };

test('the last spans are flushed at shutdown', signals, async () => {
  const { child, exited, base } = await startServer({
    ...OTLP,
    OTEL_EXPORTER_OTLP_ENDPOINT: `${receiverUrl}/flushed`,
    // Far beyond this test: anything received was sent by the shutdown.
    OTEL_BSP_SCHEDULE_DELAY: '600000',
  });
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.ok(sentTo('/flushed').some((r) => r.body.includes('GET /v1/auth/me')), 'nothing was flushed at shutdown');
});

test('an unreachable backend stops neither the API nor its shutdown', signals, async () => {
  const { child, exited, base } = await startServer({ ...OTLP, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9', OTEL_BSP_SCHEDULE_DELAY: '100' });
  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  await sleep(300);
  child.kill('SIGTERM');
  assert.equal((await exited).code, 0);
});
