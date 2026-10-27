// Runs in its own process so AUTH_PROVIDER can be overridden before the app boots.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { SignJWT } from 'jose';
import { createApp } from '../dist/app.js';
import { cleanup, randomIp } from './helpers.mjs';

// The booted apps are closed by each test; this empties the queues their workers created.
after(() => cleanup([], []));

async function boot(provider, env = {}) {
  Object.assign(process.env, { AUTH_PROVIDER: provider }, env);
  const app = await createApp({ logger: false, abortOnError: false });
  await app.listen(0);
  return { app, base: `http://127.0.0.1:${app.getHttpServer().address().port}/v1` };
}

// Nothing listens on port 1: the Clerk adapter cannot fetch keys, so it must still fail closed.
const CLERK_ENV = { CLERK_ISSUER: 'http://127.0.0.1:1', CLERK_WEBHOOK_SECRET: `whsec_${btoa('test-secret')}` };

test('AUTH_PROVIDER=clerk swaps in the Clerk adapter: local tokens and local login are refused', async () => {
  const { app, base } = await boot('clerk', CLERK_ENV);
  try {
    const localToken = await new SignJWT({ tid: crypto.randomUUID(), role: 'TenantAdmin', tier: 'free' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(crypto.randomUUID())
      .setIssuer('enterprise-api-starter')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const me = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${localToken}` } });
    assert.equal(me.status, 401);

    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': randomIp() },
      body: JSON.stringify({ tenantId: crypto.randomUUID(), email: 'a@b.co', password: 'x' }),
    });
    assert.equal(login.status, 409, 'sign-in happens in Clerk');
  } finally {
    await app.close();
  }
});

test('an unknown AUTH_PROVIDER stops the app from starting', async () => {
  await assert.rejects(boot('clerck'), /Unknown AUTH_PROVIDER "clerck"/);
});
