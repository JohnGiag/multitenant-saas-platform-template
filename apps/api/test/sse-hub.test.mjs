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
