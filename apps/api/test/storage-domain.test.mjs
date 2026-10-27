import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTenantObjectKey, newObjectKey } from '../dist/optional/storage/domain/object-key.js';
import { presignS3Url } from '../dist/optional/storage/infrastructure/sigv4.js';

// AWS's published example: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
test('presigned URLs match the AWS SigV4 reference example', () => {
  const url = presignS3Url({
    method: 'GET',
    endpoint: 'https://examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresIn: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(
    url,
    'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
      '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
      '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
      '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

test('presigned URLs encode each key segment but keep the slashes', () => {
  const url = presignS3Url({
    method: 'PUT',
    endpoint: 'https://acc.r2.cloudflarestorage.com/ignored',
    path: "/bucket/t1/a b(1)'é.pdf",
    region: 'auto',
    accessKeyId: 'id',
    secretAccessKey: 'secret',
    expiresIn: 900,
    now: new Date(),
  });
  assert.ok(url.startsWith('https://acc.r2.cloudflarestorage.com/bucket/t1/a%20b%281%29%27%C3%A9.pdf?'), url);
});

test('object keys stay under the tenant prefix', () => {
  const key = newObjectKey('t1', 'report.pdf');
  assert.match(key, /^t1\/[0-9a-f-]{36}\/report\.pdf$/);
  assert.ok(isTenantObjectKey('t1', key));

  for (const bad of ['t2/x/report.pdf', 't1', 't1/', 't1//x', 't1/../t2/x', 't1/./x', 't1x/y', '/t1/x']) {
    assert.equal(isTenantObjectKey('t1', bad), false, bad);
  }
});
