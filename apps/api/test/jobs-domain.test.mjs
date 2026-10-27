import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnv } from '../dist/config/env.validation.js';
import { jobConfig } from '../dist/modules/jobs/job-config.js';
import { NotificationChannelRegistry } from '../dist/modules/notifications/domain/notification-channel.js';

const configOf = (values) => ({ get: (name) => values[name] });

test('job config: defaults, overrides, and a bad value fails at boot', () => {
  assert.deepEqual(jobConfig(configOf({})), {
    attempts: 3,
    backoffMs: 1000,
    concurrency: 5,
    maxDeadLetters: 10_000,
    prefix: 'bull',
  });
  assert.deepEqual(
    jobConfig(configOf({ JOB_ATTEMPTS: '5', WORKER_CONCURRENCY: '20', DLQ_MAX_ENTRIES: '50', QUEUE_PREFIX: 'stg' })),
    { attempts: 5, backoffMs: 1000, concurrency: 20, maxDeadLetters: 50, prefix: 'stg' },
  );
  for (const bad of ['0', '-1', '1.5', 'many']) {
    assert.throws(() => jobConfig(configOf({ JOB_ATTEMPTS: bad })), /JOB_ATTEMPTS must be a positive integer/, bad);
  }
});

test('env validation rejects an unknown AUTH_PROVIDER before anything starts', () => {
  assert.deepEqual(validateEnv({ X: '1' }), { X: '1' });
  assert.doesNotThrow(() => validateEnv({ AUTH_PROVIDER: 'local' }));
  assert.throws(() => validateEnv({ AUTH_PROVIDER: 'clerck' }), /Unknown AUTH_PROVIDER "clerck"/);
});

test('Clerk mode needs its issuer and webhook secret before anything starts', () => {
  const clerk = { AUTH_PROVIDER: 'clerk', CLERK_ISSUER: 'https://x.clerk.accounts.dev', CLERK_WEBHOOK_SECRET: 'whsec_abc' };
  assert.doesNotThrow(() => validateEnv(clerk));
  assert.throws(() => validateEnv({ ...clerk, CLERK_ISSUER: undefined }), /CLERK_ISSUER/);
  assert.throws(() => validateEnv({ ...clerk, CLERK_ISSUER: 'not a url' }), /CLERK_ISSUER/);
  assert.throws(() => validateEnv({ ...clerk, CLERK_WEBHOOK_SECRET: undefined }), /CLERK_WEBHOOK_SECRET/);
  assert.throws(() => validateEnv({ ...clerk, CLERK_WEBHOOK_SECRET: 'sk_live_wrong_secret' }), /CLERK_WEBHOOK_SECRET/);
  // Local mode does not need them.
  assert.doesNotThrow(() => validateEnv({ AUTH_PROVIDER: 'local' }));
});

test('channel registry: lookup by key, and a duplicate key is a startup error', () => {
  const registry = new NotificationChannelRegistry();
  const email = { key: 'email', integration: 'resend', deliver: async () => {} };
  registry.register(email);
  assert.equal(registry.get('email'), email);
  assert.equal(registry.get('push'), undefined);
  assert.deepEqual(registry.all(), [email]);
  assert.throws(() => registry.register({ ...email }), /registered twice/);
});
