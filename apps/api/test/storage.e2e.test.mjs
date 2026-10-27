import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MAX_UPLOAD_BYTES, PresignedDownloadSchema, PresignedUploadSchema } from '@repo/shared-types';
import { PLATFORM_QUOTA } from '../dist/optional/storage/domain/platform-quota.js';
import { cleanup, db, seedTenant, startApp } from './helpers.mjs';

// Platform defaults; the real src/optional/storage module is installed.
const PLATFORM = 'https://platform.r2.example.test';
Object.assign(process.env, {
  STORAGE_ENDPOINT: PLATFORM,
  STORAGE_BUCKET: 'platform-bucket',
  STORAGE_ACCESS_KEY_ID: 'platform-id',
  STORAGE_SECRET_ACCESS_KEY: 'platform-secret',
});
delete process.env.STORAGE_REGION;

// The API's own requests to the platform bucket (deletions) are recorded, not sent.
const deleted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== PLATFORM) return realFetch(input, init);
  assert.equal(init?.method, 'DELETE');
  deleted.push(decodeURIComponent(url.pathname.replace('/platform-bucket/', '')));
  return Promise.resolve(new Response(null, { status: 204 }));
};

const BYOK = {
  endpoint: 'https://tenant.s3.example.test',
  region: 'eu-west-1',
  bucket: 'tenant-bucket',
  accessKeyId: 'tenant-id',
  secretAccessKey: 'tenant-secret',
};
const tenants = {};
const tokens = {};
let app, call, login;

before(async () => {
  tenants.platform = await seedTenant('storage-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('storage-e2e-a', { admin: 'TenantAdmin', user: 'User', other: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('storage-e2e-b', { user: 'User' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.otherA = await login(tenants.a, 'other@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.userB = await login(tenants.b, 'user@example.com');
});

after(async () => {
  globalThis.fetch = realFetch;
  await cleanup(app, Object.values(tenants));
});

const upload = (token, filename, size = 10, extra) =>
  call('POST', '/storage/uploads', { token, body: { filename, size }, ...extra });
const keyQuery = (key) => `?key=${encodeURIComponent(key)}`;
const download = (token, key, extra) => call('GET', `/storage/downloads${keyQuery(key)}`, { token, ...extra });
const remove = (token, key) => call('DELETE', `/storage/objects${keyQuery(key)}`, { token });
const setByok = (config, enabled = true) =>
  call('PUT', '/integrations/r2', { token: tokens.adminA, body: { config, enabled } });
const uploadUrl = async (...args) => new URL((await (await upload(...args)).json()).url);
// A platform file of tenant B, uploaded by its user, taking `size` bytes of quota.
const seedFileOfB = async (size) => {
  const uploaderId = (await db.user.findFirstOrThrow({ where: { tenantId: tenants.b } })).id;
  const key = `${tenants.b}/${crypto.randomUUID()}/filler.bin`;
  await db.storageObject.create({ data: { tenantId: tenants.b, key, size, uploaderId } });
  return key;
};

test('uploads get a tenant-prefixed key and a presigned PUT for exactly their size', async () => {
  const res = await upload(tokens.userA, 'report.pdf', 1234);
  assert.equal(res.status, 201);
  const body = PresignedUploadSchema.parse(await res.json());
  assert.match(body.key, new RegExp(`^${tenants.a}/[0-9a-f-]{36}/report\\.pdf$`));

  const url = new URL(body.url);
  assert.equal(url.origin, PLATFORM);
  assert.equal(url.pathname, `/platform-bucket/${body.key}`);
  assert.match(url.searchParams.get('X-Amz-Credential'), /^platform-id\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;host');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.ok(!body.url.includes('platform-secret'));
  // Reserved against the tenant's platform quota.
  assert.equal((await db.storageObject.findUniqueOrThrow({ where: { key: body.key } })).size, 1234);

  const dl = await download(tokens.auditorA, body.key);
  assert.equal(dl.status, 200);
  const dlUrl = new URL(PresignedDownloadSchema.parse(await dl.json()).url);
  assert.equal(dlUrl.origin, PLATFORM);
  assert.equal(dlUrl.searchParams.get('response-content-disposition'), 'attachment');
});

test('files over 1 MB, empty ones and unsized ones are refused', async () => {
  assert.equal((await upload(tokens.userA, 'big.bin', MAX_UPLOAD_BYTES + 1)).status, 400);
  assert.equal((await upload(tokens.userA, 'empty.bin', 0)).status, 400);
  const unsized = await call('POST', '/storage/uploads', { token: tokens.userA, body: { filename: 'x.txt' } });
  assert.equal(unsized.status, 400);
  assert.equal((await upload(tokens.userA, 'max.bin', MAX_UPLOAD_BYTES)).status, 201);
});

test('the platform bucket has a quota per tenant; deleting files frees it', async () => {
  await db.storageObject.deleteMany({ where: { tenantId: tenants.b } });
  // Tenant B has used all but 100 bytes.
  const filler = await seedFileOfB(PLATFORM_QUOTA.bytes - 100);

  const res = await upload(tokens.userB, 'b.txt', 101);
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /quota/);
  assert.equal(await db.storageObject.count({ where: { tenantId: tenants.b } }), 1);
  // Tenant A is unaffected.
  assert.equal((await upload(tokens.userA, 'a.txt', 101)).status, 201);

  assert.equal((await remove(tokens.userB, filler)).status, 204);
  assert.ok(deleted.includes(filler), 'the file was not deleted from the bucket');
  assert.equal(await db.storageObject.count({ where: { key: filler } }), 0);
  assert.equal((await upload(tokens.userB, 'b.txt', 101)).status, 201);
});

test('concurrent uploads cannot both take the last free space', async () => {
  await db.storageObject.deleteMany({ where: { tenantId: tenants.b } });
  await seedFileOfB(PLATFORM_QUOTA.bytes - 100);
  const statuses = (await Promise.all([1, 2, 3].map(() => upload(tokens.userB, 'race.txt', 60)))).map((r) => r.status);
  assert.deepEqual(statuses.sort(), [201, 409, 409]);
  await db.storageObject.deleteMany({ where: { tenantId: tenants.b } });
});

test('only the uploader or a TenantAdmin may delete a file', async () => {
  const { key: mine } = await (await upload(tokens.userA, 'mine.txt')).json();
  const { key: theirs } = await (await upload(tokens.userA, 'theirs.txt')).json();
  const userAId = (await db.user.findFirstOrThrow({ where: { tenantId: tenants.a, email: 'user@example.com' } })).id;
  assert.equal((await db.storageObject.findUniqueOrThrow({ where: { key: mine } })).uploaderId, userAId);

  const refused = await remove(tokens.otherA, mine);
  assert.equal(refused.status, 403);
  assert.equal(await db.storageObject.count({ where: { key: mine } }), 1);
  assert.ok(!deleted.includes(mine), 'deleted from the bucket despite the 403');
  // Reading stays tenant-wide.
  assert.equal((await download(tokens.otherA, mine)).status, 200);

  assert.equal((await remove(tokens.userA, mine)).status, 204);
  assert.equal((await remove(tokens.adminA, theirs)).status, 204);
  assert.equal(await db.storageObject.count({ where: { key: { in: [mine, theirs] } } }), 0);
});

test("a tenant cannot reach another tenant's files", async () => {
  const { key } = await (await upload(tokens.userA, 'secret.txt')).json();
  assert.equal((await download(tokens.userB, key)).status, 404);
  assert.equal((await remove(tokens.userB, key)).status, 404);
  assert.equal((await download(tokens.userB, `${tenants.b}/../${key}`)).status, 404);
  assert.equal((await download(tokens.userA, `${tenants.a}/../${tenants.b}/x`)).status, 404);
  // A key that was never uploaded, with no own bucket to look in.
  assert.equal((await download(tokens.userA, `${tenants.a}/nothing/here.txt`)).status, 404);
  assert.equal(await db.storageObject.count({ where: { key } }), 1);
});

test('filenames cannot add path segments', async () => {
  for (const filename of ['a/b.txt', '..', 'a\\b', '']) {
    assert.equal((await upload(tokens.userA, filename)).status, 400, filename);
  }
});

test('auditors cannot upload or delete, and SuperAdmin cannot reach tenant files', async () => {
  const { key } = await (await upload(tokens.userA, 'kept.txt')).json();
  assert.equal((await upload(tokens.auditorA, 'x.txt')).status, 403);
  assert.equal((await remove(tokens.auditorA, key)).status, 403);
  assert.equal((await upload(tokens.super, 'x.txt', 10, { tenant: tenants.a })).status, 403);
  assert.equal((await download(tokens.super, key, { tenant: tenants.a })).status, 403);
});

test('storage is enabled for tenants without their own bucket, thanks to the platform one', async () => {
  const res = await call('GET', '/system/capabilities', { token: tokens.userB });
  const storage = (await res.json()).capabilities.find((c) => c.key === 'storage');
  assert.deepEqual(storage, { key: 'storage', integration: 'r2', enabled: true });
});

test("the tenant's own bucket (BYOK) takes new uploads, untracked and without quota", async () => {
  const { key: platformKey } = await (await upload(tokens.userA, 'old.txt')).json();
  try {
    assert.equal((await setByok(BYOK)).status, 200);
    const res = await upload(tokens.userA, 'a.txt');
    const { key, url } = await res.json();
    const own = new URL(url);
    assert.equal(own.origin, BYOK.endpoint);
    assert.ok(own.pathname.startsWith(`/tenant-bucket/${tenants.a}/`));
    assert.match(own.searchParams.get('X-Amz-Credential'), /^tenant-id\/\d{8}\/eu-west-1\/s3\/aws4_request$/);
    assert.equal(await db.storageObject.count({ where: { key } }), 0);

    // Each file is read from where it lives.
    assert.equal(new URL((await (await download(tokens.userA, key)).json()).url).origin, BYOK.endpoint);
    assert.equal(new URL((await (await download(tokens.userA, platformKey)).json()).url).origin, PLATFORM);
    // The API never sends requests to a tenant-chosen endpoint: own-bucket files are deleted there.
    assert.equal((await remove(tokens.userA, key)).status, 404);

    // Tenant B is unaffected.
    assert.equal((await uploadUrl(tokens.userB, 'b.txt')).origin, PLATFORM);

    await setByok(BYOK, false);
    assert.equal((await uploadUrl(tokens.userA, 'a.txt')).origin, PLATFORM);

    // Broken tenant config fails loudly instead of silently using the platform bucket.
    await setByok({ endpoint: BYOK.endpoint });
    const broken = await upload(tokens.userA, 'a.txt');
    assert.equal(broken.status, 503);
    assert.ok(!(await broken.text()).includes('tenant-secret'));
  } finally {
    await call('DELETE', '/integrations/r2', { token: tokens.adminA });
  }
});

test('deleting a tenant deletes its files from the platform bucket', async () => {
  const doomed = await seedTenant('storage-e2e-doomed', { user: 'User' });
  const userToken = await login(doomed, 'user@example.com');
  const keys = [];
  for (const name of ['one.txt', 'two.txt']) keys.push((await (await upload(userToken, name)).json()).key);

  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);
  for (const key of keys) assert.ok(deleted.includes(key), `${key} left in the bucket`);
  assert.equal(await db.storageObject.count({ where: { tenantId: doomed } }), 0);
});

test("listing shows the tenant's platform files newest first, page by page, and never another tenant's", async () => {
  tenants.list = await seedTenant('storage-e2e-list', { admin: 'TenantAdmin', auditor: 'Auditor' });
  const adminToken = await login(tenants.list, 'admin@example.com');
  const keys = [];
  for (const name of ['first.txt', 'second.txt', 'third.txt']) keys.push((await (await upload(adminToken, name, 5)).json()).key);
  const otherTenantKey = await seedFileOfB(1);

  const list = async (token, query = '') => {
    const res = await call('GET', `/storage/objects${query}`, { token });
    assert.equal(res.status, 200);
    return res.json();
  };
  const page1 = await list(adminToken, '?limit=2');
  assert.deepEqual(page1.items.map((f) => f.filename), ['third.txt', 'second.txt']);
  assert.equal(page1.items[0].size, 5);
  const page2 = await list(adminToken, `?limit=2&cursor=${page1.nextCursor}`);
  assert.deepEqual(page2.items.map((f) => f.key), [keys[0]]);
  assert.equal(page2.nextCursor, null);

  // Read-only roles may list; tenant B sees only its own; SuperAdmin stays out of tenant files.
  assert.equal((await list(await login(tenants.list, 'auditor@example.com'))).items.length, 3);
  const ofB = (await list(tokens.userB, '?limit=100')).items.map((f) => f.key);
  assert.ok(ofB.includes(otherTenantKey));
  assert.ok(!keys.some((k) => ofB.includes(k)));
  assert.equal((await call('GET', '/storage/objects', { token: tokens.super, tenant: tenants.list })).status, 403);
  assert.equal((await call('GET', '/storage/objects?cursor=not-an-id', { token: adminToken })).status, 400);
});
