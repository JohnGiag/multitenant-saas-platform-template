// Needs the docker-compose database and apps/api/.env (see .env.example).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { hash } from '@node-rs/argon2';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { SignJWT } from 'jose';
import { AppModule } from '../dist/app.module.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile();

const PASSWORD = 'correct horse battery staple';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const tenants = {};
let app;
let base;

before(async () => {
  const passwordHash = await hash(PASSWORD);
  assert.match(passwordHash, /^\$argon2id\$/);
  for (const name of ['a', 'b']) {
    const { id } = await db.tenant.create({ data: { name: `auth-e2e-${name}` } });
    tenants[name] = id;
    await db.user.createMany({
      data: [
        { tenantId: id, email: 'admin@example.com', passwordHash, role: 'TenantAdmin' },
        { tenantId: id, email: 'user@example.com', passwordHash, role: 'User' },
      ],
    });
  }
  await db.user.create({ data: { tenantId: tenants.a, email: 'only-a@example.com', passwordHash } });

  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}/v1`;
});

after(async () => {
  await app?.close();
  const tenantId = { in: Object.values(tenants) };
  await db.apiKey.deleteMany({ where: { tenantId } });
  await db.user.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.$disconnect();
});

function call(method, path, { token, apiKey, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  return fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
}

async function login(tenant, email, password = PASSWORD) {
  const res = await call('POST', '/auth/login', { body: { tenantId: tenants[tenant], email, password } });
  return res.ok ? (await res.json()).accessToken : res.status;
}

test('login issues a token whose principal comes from the server', async () => {
  const token = await login('a', 'ADMIN@example.com');
  assert.equal(typeof token, 'string');
  const res = await call('GET', '/auth/me', { token });
  assert.equal(res.status, 200);
  const lowercase = await fetch(`${base}/auth/me`, { headers: { authorization: `bearer ${token}` } });
  assert.equal(lowercase.status, 200);
  const me = await res.json();
  assert.deepEqual({ kind: me.kind, tenantId: me.tenantId, role: me.role }, {
    kind: 'user',
    tenantId: tenants.a,
    role: 'TenantAdmin',
  });
});

test('login rejects wrong password, unknown email, other tenant and bad input', async () => {
  assert.equal(await login('a', 'admin@example.com', 'wrong password'), 401);
  assert.equal(await login('a', 'nobody@example.com'), 401);
  assert.equal(await login('b', 'only-a@example.com'), 401);
  const res = await call('POST', '/auth/login', { body: { tenantId: 'not-a-uuid', email: 'x' } });
  assert.equal(res.status, 400);
});

test('protected routes reject missing, garbage and forged tokens', async () => {
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: 'garbage' })).status, 401);
  const forged = await new SignJWT({ tid: tenants.a, role: 'SuperAdmin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(crypto.randomUUID())
    .setIssuer('enterprise-api-starter')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('x'.repeat(48)));
  assert.equal((await call('GET', '/auth/me', { token: forged })).status, 401);
});

test('API keys: role-gated, tenant-isolated, revocable', async () => {
  const adminA = await login('a', 'admin@example.com');
  const adminB = await login('b', 'admin@example.com');
  const userA = await login('a', 'user@example.com');

  assert.equal((await call('POST', '/api-keys', { token: userA, body: { name: 'x' } })).status, 403);
  const superKey = await call('POST', '/api-keys', { token: adminA, body: { name: 'x', role: 'SuperAdmin' } });
  assert.equal(superKey.status, 400);

  const created = await call('POST', '/api-keys', { token: adminA, body: { name: 'ci' } });
  assert.equal(created.status, 201);
  const { id, key } = await created.json();

  const me = await (await call('GET', '/auth/me', { apiKey: key })).json();
  assert.deepEqual({ kind: me.kind, id: me.id, tenantId: me.tenantId, role: me.role }, {
    kind: 'apiKey',
    id,
    tenantId: tenants.a,
    role: 'User',
  });
  assert.equal((await call('POST', '/api-keys', { apiKey: key, body: { name: 'y' } })).status, 403);

  const row = await db.apiKey.findUniqueOrThrow({ where: { id } });
  assert.ok(!Buffer.from(row.secretHash).toString().includes(key.split('_').pop()), 'secret stored in clear');

  // Tenant B cannot revoke tenant A's key.
  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminB })).status, 404);
  assert.equal((await call('GET', '/auth/me', { apiKey: key })).status, 200);

  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminA })).status, 204);
  assert.equal((await call('GET', '/auth/me', { apiKey: key })).status, 401);
  assert.equal((await call('DELETE', `/api-keys/${id}`, { token: adminA })).status, 404);
  assert.equal((await call('DELETE', '/api-keys/not-a-uuid', { token: adminA })).status, 400);
});
