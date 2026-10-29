// Shared e2e setup. Needs the docker-compose database and Redis, and apps/api/.env (see README).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue } from 'bullmq';
import { createApp } from '../dist/app.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile();

// Public routes (login) are rate limited per client IP. Each test process sends its own random IP
// through one trusted proxy hop, so parallel test files and repeated runs never share a bucket.
process.env.TRUST_PROXY_HOPS = '1';
export const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join('.')}`;
const CLIENT_IP = randomIp();

// The suite tests local mode whatever .env says; clerk.e2e and auth-provider.e2e switch it themselves.
process.env.AUTH_PROVIDER = 'local';
// No /docs by default: fixture modules' controllers are not documented. openapi.e2e turns it on.
process.env.API_DOCS = 'false';

// The offline suite never sends real email: tests stub Resend, and this fake key makes any request a
// stub misses fail instead of sending. Only test/live/ uses the real RESEND_PLATFORM_KEY.
process.env.RESEND_PLATFORM_KEY = 're_offline_test_suite';
process.env.APP_URL = 'https://app.example.test';
// Billing off unless a test turns it on with its own fake keys (billing.e2e): real test-mode keys in .env are for
// test/live/ only. Empty, not deleted, so ConfigModule does not fill them back in from .env.
for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ENTERPRISE']) process.env[name] = '';

// Same idea for queues: each test process has its own, so no worker picks up another file's jobs.
export const QUEUE_PREFIX = `test-${crypto.randomUUID().slice(0, 8)}`;
process.env.QUEUE_PREFIX = QUEUE_PREFIX;
// Captured now: a test may point the app at an unreachable Redis afterwards.
export const QUEUE_CONNECTION = { url: process.env.REDIS_URL };
export const testQueue = (name) => new Queue(name, { connection: QUEUE_CONNECTION, prefix: QUEUE_PREFIX });

export const PASSWORD = 'correct horse battery staple';
export const FIXTURES = join(import.meta.dirname, 'fixtures');
// email (resend), push (fcm), storage (r2) and webhooks (no integration).
export const OPTIONAL_FIXTURES = join(FIXTURES, 'optional');
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const passwordHash = hash(PASSWORD);

// users: { admin: 'TenantAdmin' } creates admin@example.com with that role.
export async function seedTenant(name, users = {}) {
  const { id } = await db.tenant.create({ data: { name } });
  const hashed = await passwordHash;
  await db.user.createMany({
    data: Object.entries(users).map(([local, role]) => ({
      tenantId: id,
      email: `${local}@example.com`,
      passwordHash: hashed,
      role,
    })),
  });
  return id;
}

// One user, by default with a unique email: sign-in by email and password resets look across tenants, so
// the shared admin@example.com-style addresses would collide with other test files running at the same time.
export async function seedUser(tenantId, { email = `u-${crypto.randomUUID()}@example.com`, role = 'User', password } = {}) {
  await db.user.create({ data: { tenantId, email, role, passwordHash: password ? await hash(password) : await passwordHash } });
  return email;
}

// optionalModulesDir: install fixture optional modules instead of the real src/optional ones.
export async function startApp({ optionalModulesDir } = {}) {
  const app = await createApp({ logger: false, optionalModulesDir });
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/v1`;

  function call(method, path, { token, apiKey, tenant, body, ip = CLIENT_IP, headers: extra } = {}) {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    if (apiKey) headers['x-api-key'] = apiKey;
    if (tenant) headers['x-tenant-id'] = tenant;
    return fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  }

  // Returns the access token, or the HTTP status when login fails.
  async function login(tenantId, email, password = PASSWORD) {
    const res = await call('POST', '/auth/login', { body: { tenantId, email, password } });
    return res.ok ? (await res.json()).accessToken : res.status;
  }

  return { app, base, call, login };
}

export async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`timed out after ${timeoutMs} ms`);
}

export async function cleanup(apps, tenantIds) {
  for (const app of [apps].flat()) await app?.close();
  for (const name of ['notifications', 'notifications-dlq']) {
    const queue = testQueue(name);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  const tenantId = { in: tenantIds };
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.tenantIntegration.deleteMany({ where: { tenantId } });
  await db.invitation.deleteMany({ where: { tenantId } });
  await db.apiKey.deleteMany({ where: { tenantId } });
  // Also removes their push devices and password resets (cascade).
  await db.user.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.$disconnect();
}
