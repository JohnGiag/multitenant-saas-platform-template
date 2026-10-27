// Opt-in, not part of `pnpm test`: uploads test/live/fixtures/hello.txt to the STORAGE_* bucket through a
// presigned PUT, downloads it through a presigned GET, then deletes it. The bucket is handed to the real
// provider as a tenant's own (BYOK) bucket, so nothing touches the database.
// Run: pnpm --filter @repo/api test:live (after a build).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { newObjectKey } from '../../dist/optional/storage/domain/object-key.js';
import { S3StorageProvider } from '../../dist/optional/storage/infrastructure/s3-storage.provider.js';
import { presignS3Url } from '../../dist/optional/storage/infrastructure/sigv4.js';

if (existsSync('.env')) process.loadEnvFile();
const env = process.env;
const TENANT = 'live-test';
const file = readFileSync(join(import.meta.dirname, 'fixtures', 'hello.txt'));

test('a file goes to the bucket and back through presigned URLs', { skip: !env.STORAGE_ENDPOINT && 'STORAGE_ENDPOINT is not set' }, async (t) => {
  const bucket = {
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION || 'auto',
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  };
  const storage = new S3StorageProvider(
    { getSecrets: async () => bucket },
    // Nothing is tracked: the file lives in the tenant's own bucket.
    { storageObject: { count: async () => 0 } },
    { get: () => undefined },
    { register: () => {} },
  );
  const key = newObjectKey(TENANT, 'hello.txt');
  t.after(async () => {
    const res = await fetch(
      presignS3Url({ ...bucket, method: 'DELETE', path: `/${bucket.bucket}/${key}`, expiresIn: 60, now: new Date() }),
      { method: 'DELETE' },
    );
    assert.ok(res.ok, `cleanup DELETE answered ${res.status}: ${await res.text()}`);
  });

  const upload = await storage.presignUpload(TENANT, key, file.length, crypto.randomUUID());
  // The size is signed: a body of any other length is refused.
  const wrongSize = await fetch(upload.url, { method: 'PUT', body: Buffer.concat([file, Buffer.from('!')]) });
  assert.equal(wrongSize.status, 403, `a wrong-size PUT answered ${wrongSize.status}`);
  const put = await fetch(upload.url, { method: 'PUT', body: file });
  assert.equal(put.status, 200, `PUT answered ${put.status}: ${await put.text()}`);

  const download = await storage.presignDownload(TENANT, key);
  const get = await fetch(download.url);
  assert.equal(get.status, 200, `GET answered ${get.status}: ${await get.clone().text()}`);
  assert.equal(get.headers.get('content-disposition'), 'attachment');
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), file);
});
