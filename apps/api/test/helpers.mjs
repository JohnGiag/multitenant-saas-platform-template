// Shared e2e setup. Needs the docker-compose database and apps/api/.env (see README).
import { existsSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../dist/app.module.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile();

export const PASSWORD = 'correct horse battery staple';
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

export async function startApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/v1`;

  function call(method, path, { token, apiKey, tenant, body } = {}) {
    const headers = { 'content-type': 'application/json' };
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

export async function cleanup(app, tenantIds) {
  await app?.close();
  const tenantId = { in: tenantIds };
  await db.tenantIntegration.deleteMany({ where: { tenantId } });
  await db.apiKey.deleteMany({ where: { tenantId } });
  await db.user.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.$disconnect();
}
