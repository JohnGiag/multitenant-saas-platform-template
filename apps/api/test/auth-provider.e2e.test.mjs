// Runs in its own process so AUTH_PROVIDER can be overridden before the app boots.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { createApp } from '../dist/app.js';
import { randomIp } from './helpers.mjs';

async function boot(provider) {
  process.env.AUTH_PROVIDER = provider;
  const app = await createApp({ logger: false, abortOnError: false });
  await app.listen(0);
  return { app, base: `http://127.0.0.1:${app.getHttpServer().address().port}/v1` };
}

test('AUTH_PROVIDER=clerk swaps in the Clerk adapter, which fails closed', async () => {
  const { app, base } = await boot('clerk');
  try {
    const localToken = await new SignJWT({ tid: crypto.randomUUID(), role: 'TenantAdmin' })
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
    assert.equal(login.status, 401);
  } finally {
    await app.close();
  }
});

test('an unknown AUTH_PROVIDER stops the app from starting', async () => {
  await assert.rejects(boot('clerck'), /Unknown AUTH_PROVIDER "clerck"/);
});
