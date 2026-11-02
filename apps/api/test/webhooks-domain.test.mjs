import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyWebhookSignature } from '../dist/modules/auth/domain/webhook-signature.js';
import { TenantEvents } from '../dist/modules/events/domain/tenant-events.js';
import { isPublicAddress } from '../dist/optional/webhooks/domain/address-policy.js';
import { DELIVERY_ATTEMPTS, endpointUrlProblem, isRetryableStatus, retryDelay, RETRY_DELAYS_MS } from '../dist/optional/webhooks/domain/delivery-policy.js';
import { newWebhookSecret, signWebhook } from '../dist/optional/webhooks/domain/standard-webhooks.js';
import { BlockedAddressError, postWebhook } from '../dist/optional/webhooks/infrastructure/https-delivery.js';

test('only public internet addresses are allowed, in IPv4 and IPv6', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1', // IPv4-mapped
    '::ffff:7f00:1',
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    '2002:a00:1::', // 6to4 of 10.0.0.1
    'localhost',
    'not an address',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('deliveries are signed per Standard Webhooks, verifiable like the Svix webhooks Clerk sends', () => {
  const secret = newWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9+/]{43}=$/);
  const body = JSON.stringify({ id: 'evt_1', type: 'member.joined' });
  const timestamp = 1_800_000_000;
  const signatures = signWebhook({ secret, id: 'evt_1', timestamp, body });
  assert.match(signatures, /^v1,/);
  const verify = (overrides) =>
    verifyWebhookSignature({ secret, id: 'evt_1', timestamp: String(timestamp), signatures, body, nowSeconds: timestamp, ...overrides });
  assert.equal(verify(), true);
  assert.equal(verify({ body: body.replace('joined', 'removed') }), false);
  assert.equal(verify({ secret: newWebhookSecret() }), false);
  assert.equal(verify({ id: 'evt_2' }), false);
});

test('about a day of retries on the Standard Webhooks schedule, and only for failures that may pass', () => {
  assert.equal(DELIVERY_ATTEMPTS, 8);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelay), [...RETRY_DELAYS_MS]);
  assert.equal(retryDelay(1), 5_000);
  const totalHours = RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) / 3_600_000;
  assert.ok(totalHours > 27 && totalHours < 28, `${totalHours} h`);
  for (const status of [408, 429, 500, 502, 503]) assert.equal(isRetryableStatus(status), true, String(status));
  for (const status of [301, 400, 401, 403, 404, 410, 413]) assert.equal(isRetryableStatus(status), false, String(status));
});

test('endpoint URLs: https only, without credentials (http only when private targets are allowed)', () => {
  assert.equal(endpointUrlProblem('https://hooks.example.com/in', false), null);
  assert.match(endpointUrlProblem('http://hooks.example.com/in', false), /https/);
  assert.equal(endpointUrlProblem('http://localhost:4000/in', true), null);
  assert.match(endpointUrlProblem('https://user:pass@hooks.example.com/', false), /credentials/);
});

test('a delivery never connects to a private address, written in the URL or resolved from a name', async () => {
  const send = (url) => postWebhook(new URL(url), {}, '{}', false);
  await assert.rejects(send('https://127.0.0.1/hook'), BlockedAddressError);
  await assert.rejects(send('https://[::1]/hook'), BlockedAddressError);
  await assert.rejects(send('https://169.254.169.254/latest/meta-data'), BlockedAddressError);
  await assert.rejects(send('http://hooks.example.com/'), BlockedAddressError, 'plain http');
  // "localhost" resolves to a loopback address: refused at connection time, by the lookup.
  await assert.rejects(send('https://localhost:9/hook'), /not a public address/);
});

test('an event reaches every listener; a failing one does not stop the others and is thrown, so its job retries', async () => {
  const events = new TenantEvents();
  const event = { id: 'evt_1', type: 'member.joined', tenantId: 't1', occurredAt: new Date(), data: { userId: 'u1' } };
  await events.dispatch(event); // no listener: nothing happens

  const received = [];
  events.subscribe(async () => {
    throw new Error('queue down');
  });
  events.subscribe(async (e) => received.push(e));
  await assert.rejects(events.dispatch(event), /queue down/);
  assert.deepEqual(received, [event]);

  assert.ok(events.declaredTypes().includes('api_key.created'));
  events.declare('badge.earned');
  assert.ok(events.declaredTypes().includes('badge.earned'));
});
