import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { toCursorPage } from '../dist/common/cursor-page.js';
import { maskConfig } from '../dist/modules/integrations/domain/masking.js';
import { openSecret, parseMasterKey, sealSecret } from '../dist/modules/integrations/domain/secret-box.js';
import { resolveTenantId } from '../dist/modules/tenancy/domain/tenant-context.js';

const own = crypto.randomUUID();
const other = crypto.randomUUID();
const as = (role) => ({ kind: 'user', id: crypto.randomUUID(), tenantId: own, role });

test('tenant context: own tenant by default, foreign tenant only for SuperAdmin', () => {
  assert.equal(resolveTenantId(as('TenantAdmin'), undefined), own);
  assert.equal(resolveTenantId(as('TenantAdmin'), own), own);
  for (const role of ['TenantAdmin', 'User', 'Auditor']) assert.equal(resolveTenantId(as(role), other), null);
  assert.equal(resolveTenantId(as('SuperAdmin'), other), other);
  assert.equal(resolveTenantId({ ...as('User'), kind: 'apiKey' }, other), null);
});

test('cursor page: next cursor only when an extra row exists', () => {
  const id = (x) => String(x);
  assert.deepEqual(toCursorPage([], 2, id), { items: [], nextCursor: null });
  assert.deepEqual(toCursorPage([1, 2], 2, id), { items: [1, 2], nextCursor: null });
  assert.deepEqual(toCursorPage([1, 2, 3], 2, id), { items: [1, 2], nextCursor: '2' });
});

const key = randomBytes(32);
const ctx = `${own}/resend`;

test('secret box round-trips with a fresh 96-bit IV every time', () => {
  const a = sealSecret(key, '{"apiKey":"s3cret"}', ctx);
  const b = sealSecret(key, '{"apiKey":"s3cret"}', ctx);
  assert.equal(a[0], 1, 'version byte');
  assert.equal(a.length, 1 + 12 + 16 + '{"apiKey":"s3cret"}'.length);
  assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13), 'IV reused');
  assert.ok(!Buffer.from(a).toString('latin1').includes('s3cret'), 'plaintext visible');
  assert.equal(openSecret(key, a, ctx), '{"apiKey":"s3cret"}');
  assert.equal(openSecret(key, b, ctx), '{"apiKey":"s3cret"}');
});

test('secret box rejects tampering, another context and another key', () => {
  const sealed = sealSecret(key, 'payload', ctx);
  for (const index of [1, 13, 29, sealed.length - 1]) {
    const tampered = Uint8Array.from(sealed);
    tampered[index] ^= 1;
    assert.throws(() => openSecret(key, tampered, ctx), undefined, `byte ${index}`);
  }
  assert.throws(() => openSecret(key, sealed, `${other}/resend`));
  assert.throws(() => openSecret(key, sealed, `${own}/r2`));
  assert.throws(() => openSecret(randomBytes(32), sealed, ctx));
  assert.throws(() => openSecret(key, sealed.subarray(0, 20), ctx), /Unsupported secret format/);
  assert.throws(() => openSecret(key, Uint8Array.of(2, ...sealed.subarray(1)), ctx), /Unsupported secret format/);
});

test('master key must be exactly 32 bytes of base64', () => {
  assert.equal(parseMasterKey(randomBytes(32).toString('base64')).length, 32);
  for (const bad of ['', randomBytes(31).toString('base64'), randomBytes(33).toString('base64'), randomBytes(32).toString('hex')]) {
    assert.throws(() => parseMasterKey(bad), /BYOK_MASTER_KEY/);
  }
});

test('masking never reveals short values and only the tail of long ones', () => {
  assert.deepEqual(maskConfig({ apiKey: 're_live_1234567890abcdef', region: 'eu-west-1', empty: '' }), {
    apiKey: '****cdef',
    region: '****',
    empty: '****',
  });
});
