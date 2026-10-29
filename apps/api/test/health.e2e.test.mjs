import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HealthSchema } from '@repo/shared-types';
import { cleanup, startApp, waitFor } from './helpers.mjs';

let app, call;

before(async () => {
  ({ app, call } = await startApp());
});

after(() => cleanup(app, []));

test('liveness and readiness answer without credentials while Postgres and Redis are up', async () => {
  const live = await call('GET', '/health');
  assert.equal(live.status, 200);
  HealthSchema.parse(await live.json());
  // Still metered per IP, like every public route.
  assert.ok(live.headers.get('x-ratelimit-limit'));

  // A fresh instance can report "not ready" while its first database connection opens (slow when the whole suite
  // boots at once): what a probe is for, so wait for it rather than expect it on the first try.
  let ready;
  await waitFor(async () => (ready = await call('GET', '/health/ready')).status === 200, 15_000);
  HealthSchema.parse(await ready.json());
  assert.ok(ready.headers.get('x-ratelimit-limit'));
});
