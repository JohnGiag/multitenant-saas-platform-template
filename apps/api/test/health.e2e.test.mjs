import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HealthSchema } from '@repo/shared-types';
import { cleanup, startApp } from './helpers.mjs';

let app, call;

before(async () => {
  ({ app, call } = await startApp());
});

after(() => cleanup(app, []));

test('liveness and readiness answer without credentials while Postgres and Redis are up', async () => {
  for (const path of ['/health', '/health/ready']) {
    const res = await call('GET', path);
    assert.equal(res.status, 200, path);
    HealthSchema.parse(await res.json());
    // Still metered per IP, like every public route.
    assert.ok(res.headers.get('x-ratelimit-limit'), path);
  }
});
