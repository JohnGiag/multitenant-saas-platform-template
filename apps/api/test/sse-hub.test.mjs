import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { MAX_STREAM_MS, SseHub } from '../dist/modules/notifications/infrastructure/sse-hub.js';

test('a stream is closed after the lifetime of an access token, so it cannot outlive its sign-in', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    // stream() never touches Redis; only onModuleInit does.
    const hub = new SseHub(undefined);
    let completed = false;
    const subscription = hub.stream('t1', 'u1').subscribe({ complete: () => (completed = true) });

    mock.timers.tick(MAX_STREAM_MS - 1);
    assert.equal(completed, false);
    mock.timers.tick(1);
    assert.equal(completed, true);
    subscription.unsubscribe();
  } finally {
    mock.timers.reset();
  }
});

test('an event reaches the streams of its recipient in its tenant, under the type it was published with', async () => {
  // Redis Pub/Sub in one process: what is published comes back on the subscribing connection.
  let onMessage;
  const subscriber = { on: (_event, listener) => (onMessage = listener), subscribe: async () => {}, disconnect() {} };
  const hub = new SseHub({ duplicate: () => subscriber, publish: async (channel, raw) => onMessage(channel, raw) });
  hub.onModuleInit();
  const received = {};
  const open = (name, tenantId, recipientId) => hub.stream(tenantId, recipientId).subscribe((event) => (received[name] ??= []).push(event));
  const streams = [open('player', 't1', 'player:1'), open('secondTab', 't1', 'player:1'), open('otherRecipient', 't1', 'u1'), open('otherTenant', 't2', 'player:1')];

  await hub.publish('t1', 'player:1', 'update', { points: 10 });
  await hub.publish('t1', 'u1', 'notification', { title: 'Hi' });

  assert.deepEqual(received.player, [{ type: 'update', data: { points: 10 } }]);
  assert.deepEqual(received.secondTab, received.player);
  assert.deepEqual(received.otherRecipient, [{ type: 'notification', data: { title: 'Hi' } }]);
  assert.equal(received.otherTenant, undefined, 'the same recipient id in another tenant hears nothing');
  for (const stream of streams) stream.unsubscribe();
  hub.onModuleDestroy();
});
