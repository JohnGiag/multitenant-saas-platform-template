import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PresignedDownloadSchema, PresignedUploadSchema } from '@repo/shared-types';
import { cleanup, seedTenant, startApp } from './helpers.mjs';

// Platform defaults; the real src/optional/storage module is installed.
Object.assign(process.env, {
  STORAGE_ENDPOINT: 'https://platform.r2.example.test',
  STORAGE_BUCKET: 'platform-bucket',
  STORAGE_ACCESS_KEY_ID: 'platform-id',
  STORAGE_SECRET_ACCESS_KEY: 'platform-secret',
});
delete process.env.STORAGE_REGION;

const BYOK = {
  endpoint: 'https://tenant.s3.example.test',
  region: 'eu-west-1',
  bucket: 'tenant-bucket',
  accessKeyId: 'tenant-id',
  secretAccessKey: 'tenant-secret',
};
const tenants = {};
const tokens = {};
let app, call;

before(async () => {
  tenants.platform = await seedTenant('storage-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('storage-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('storage-e2e-b', { user: 'User' });
  let login;
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.userB = await login(tenants.b, 'user@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

const upload = (token, filename, extra) => call('POST', '/storage/uploads', { token, body: { filename }, ...extra });
const download = (token, key, extra) =>
  call('GET', `/storage/downloads?key=${encodeURIComponent(key)}`, { token, ...extra });
const setByok = (config, enabled = true) =>
  call('PUT', '/integrations/r2', { token: tokens.adminA, body: { config, enabled } });

test('uploads get a tenant-prefixed key and a presigned PUT on the platform bucket', async () => {
  const res = await upload(tokens.userA, 'report.pdf');
  assert.equal(res.status, 201);
  const body = PresignedUploadSchema.parse(await res.json());
  assert.match(body.key, new RegExp(`^${tenants.a}/[0-9a-f-]{36}/report\\.pdf$`));

  const url = new URL(body.url);
  assert.equal(url.origin, 'https://platform.r2.example.test');
  assert.equal(url.pathname, `/platform-bucket/${body.key}`);
  assert.match(url.searchParams.get('X-Amz-Credential'), /^platform-id\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.ok(!body.url.includes('platform-secret'));

  const dl = await download(tokens.auditorA, body.key);
  assert.equal(dl.status, 200);
  const dlUrl = new URL(PresignedDownloadSchema.parse(await dl.json()).url);
  assert.equal(dlUrl.searchParams.get('response-content-disposition'), 'attachment');
});

test("a tenant cannot get URLs for another tenant's objects", async () => {
  const { key } = await (await upload(tokens.userA, 'secret.txt')).json();
  assert.equal((await download(tokens.userB, key)).status, 404);
  const escaping = `${tenants.b}/../${key}`;
  assert.equal((await download(tokens.userB, escaping)).status, 404);
  assert.equal((await download(tokens.userA, `${tenants.a}/../${tenants.b}/x`)).status, 404);
});

test('filenames cannot add path segments', async () => {
  for (const filename of ['a/b.txt', '..', 'a\\b', '']) {
    assert.equal((await upload(tokens.userA, filename)).status, 400, filename);
  }
});

test('auditors cannot upload and SuperAdmin cannot reach tenant files', async () => {
  assert.equal((await upload(tokens.auditorA, 'x.txt')).status, 403);
  assert.equal((await upload(tokens.super, 'x.txt', { tenant: tenants.a })).status, 403);
  assert.equal((await download(tokens.super, `${tenants.a}/x/y`, { tenant: tenants.a })).status, 403);
});

test("the tenant's own bucket (BYOK) wins over the platform default while enabled", async () => {
  try {
    assert.equal((await setByok(BYOK)).status, 200);
    const own = new URL((await (await upload(tokens.userA, 'a.txt')).json()).url);
    assert.equal(own.origin, BYOK.endpoint);
    assert.ok(own.pathname.startsWith(`/tenant-bucket/${tenants.a}/`));
    assert.match(own.searchParams.get('X-Amz-Credential'), /^tenant-id\/\d{8}\/eu-west-1\/s3\/aws4_request$/);

    // Tenant B is unaffected.
    const other = new URL((await (await upload(tokens.userB, 'b.txt')).json()).url);
    assert.equal(other.origin, 'https://platform.r2.example.test');

    await setByok(BYOK, false);
    const fallback = new URL((await (await upload(tokens.userA, 'a.txt')).json()).url);
    assert.equal(fallback.origin, 'https://platform.r2.example.test');

    // Broken tenant config fails loudly instead of silently using the platform bucket.
    await setByok({ endpoint: BYOK.endpoint });
    const res = await upload(tokens.userA, 'a.txt');
    assert.equal(res.status, 503);
    assert.ok(!(await res.text()).includes('tenant-secret'));
  } finally {
    await call('DELETE', '/integrations/r2', { token: tokens.adminA });
  }
});
