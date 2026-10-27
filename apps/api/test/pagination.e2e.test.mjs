import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateApiKey, hashApiKeySecret } from '../dist/modules/auth/domain/api-key.js';
import { PrismaApiKeyService } from '../dist/modules/auth/infrastructure/prisma-api-key.service.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call;

// Seven keys, two pairs sharing a created_at, so the id tie-break matters.
const STAMPS = ['01', '02', '02', '03', '04', '04', '05'].map((m) => new Date(`2026-10-27T10:${m}:00.000Z`));

before(async () => {
  tenants.a = await seedTenant('page-e2e-a', { admin: 'TenantAdmin', auditor: 'Auditor', user: 'User' });
  tenants.b = await seedTenant('page-e2e-b', { admin: 'TenantAdmin' });
  for (const tenantId of [tenants.a, tenants.b]) {
    await db.apiKey.createMany({
      data: STAMPS.map((createdAt, i) => {
        const key = generateApiKey();
        return { tenantId, name: `key-${i}`, prefix: key.prefix, secretHash: hashApiKeySecret(key.secret), createdAt };
      }),
    });
  }
  let login;
  ({ app, call, login } = await startApp());
  tokens.admin = await login(tenants.a, 'admin@example.com');
  tokens.auditor = await login(tenants.a, 'auditor@example.com');
  tokens.user = await login(tenants.a, 'user@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

async function allPages(token, limit) {
  const pages = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ limit: String(limit), ...(cursor && { cursor }) });
    const res = await call('GET', `/api-keys?${qs}`, { token });
    assert.equal(res.status, 200);
    const page = await res.json();
    pages.push(page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return pages;
}

test('pages walk every key exactly once, newest first, ties broken by id', async () => {
  const expected = (await db.apiKey.findMany({ where: { tenantId: tenants.a } }))
    .sort((x, y) => y.createdAt - x.createdAt || (y.id < x.id ? -1 : 1))
    .map((k) => k.id);

  const pages = await allPages(tokens.admin, 2);
  assert.deepEqual(pages.map((p) => p.length), [2, 2, 2, 1]);
  assert.deepEqual(pages.flat().map((k) => k.id), expected);
  assert.ok(pages.flat().every((k) => !('secretHash' in k) && !('key' in k)), 'secret material listed');
});

test('tenant-scoped, role-gated and validated', async () => {
  const ids = (await allPages(tokens.admin, 100)).flat().map((k) => k.id);
  const ofB = await db.apiKey.findMany({ where: { tenantId: tenants.b }, select: { id: true } });
  assert.ok(ofB.every(({ id }) => !ids.includes(id)), "tenant B's keys listed to tenant A");

  assert.equal((await call('GET', '/api-keys', { token: tokens.auditor })).status, 200);
  assert.equal((await call('GET', '/api-keys', { token: tokens.user })).status, 403);
  assert.equal((await call('GET', '/api-keys?cursor=garbage', { token: tokens.admin })).status, 400);
  // Well-formed cursor whose value is not a timestamp: rejected before it reaches Prisma.
  const crafted = Buffer.from(JSON.stringify(['not-a-date', crypto.randomUUID()])).toString('base64url');
  assert.equal((await call('GET', `/api-keys?cursor=${crafted}`, { token: tokens.admin })).status, 400);
});

test('the query seeks through the (tenant_id, created_at, id) index: no OFFSET, no sort', async () => {
  const queries = [];
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: 'event', level: 'query' }],
  });
  client.$on('query', (e) => queries.push(e));
  try {
    const service = new PrismaApiKeyService(client);
    const first = await service.list(tenants.a, { limit: 2 });
    const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
    queries.length = 0;
    await service.list(tenants.a, { limit: 2, cursor: { value: cursor[0], id: cursor[1] } });

    const { query, params } = queries.find((q) => q.query.includes('"api_keys"'));
    const values = JSON.parse(params);
    // Prisma always emits `OFFSET $n` (logged params are strings); it must be 0, i.e. no rows thrown away.
    const offset = /OFFSET \$(\d+)/.exec(query);
    assert.ok(!offset || Number(values[Number(offset[1]) - 1]) === 0, `rows skipped by OFFSET: ${query}`);
    // Tiny test tables make a sequential scan cheapest; disable it to see which index the planner uses.
    const [{ 'QUERY PLAN': plan }] = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${query}`, ...values);
    });
    const nodes = [];
    (function walk(node) {
      nodes.push(node);
      node.Plans?.forEach(walk);
    })(plan[0].Plan);

    const scan = nodes.find((n) => n['Index Name'] === 'api_keys_tenant_id_created_at_id_idx');
    assert.ok(scan, `index not used: ${JSON.stringify(nodes.map((n) => n['Node Type']))}`);
    // Seek: the cursor bound is part of the index condition, not a filter applied after scanning.
    assert.match(scan['Index Cond'], /tenant_id.*created_at/s);
    assert.ok(!nodes.some((n) => n['Node Type'] === 'Sort'), 'rows are sorted after reading instead of by the index');
  } finally {
    await client.$disconnect();
  }
});
