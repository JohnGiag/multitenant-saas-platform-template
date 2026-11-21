// scripts/rotate-master-key.mjs: every sealed secret moves from one master key to another, all at once or not at all.
// Keys of the test's own, and only the test's tenants: the database's other secrets are never touched.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { openSecret, sealSecret } from '../dist/modules/integrations/domain/secret-box.js';
import { cleanup, db, seedTenant } from './helpers.mjs';

const newKey = () => randomBytes(32);
const tenants = {};

before(async () => {
  tenants.a = await seedTenant('rotation-e2e-a');
  tenants.b = await seedTenant('rotation-e2e-b');
});

after(() => cleanup([], Object.values(tenants)));

const rotate = (from, to, ...tenantIds) =>
  promisify(execFile)(process.execPath, ['scripts/rotate-master-key.mjs', ...tenantIds], {
    env: { ...process.env, BYOK_MASTER_KEY: from.toString('base64'), BYOK_MASTER_KEY_NEW: to.toString('base64') },
  });

// One BYOK integration and one webhook endpoint, sealed as their modules seal them.
async function seal(tenantId, key) {
  const integration = await db.tenantIntegration.create({
    data: { tenantId, provider: 'resend', maskedConfig: {}, encryptedConfig: sealSecret(key, JSON.stringify({ apiKey: `re_${tenantId}` }), `${tenantId}/resend`) },
  });
  const endpoint = await db.webhookEndpoint.create({
    data: { tenantId, url: 'https://example.com/hook', events: [], encryptedSecret: sealSecret(key, `whsec_${tenantId}`, `${tenantId}/webhooks`) },
  });
  return { integration: integration.id, endpoint: endpoint.id };
}

async function opened(ids, key, tenantId) {
  const integration = await db.tenantIntegration.findFirstOrThrow({ where: { id: ids.integration, tenantId } });
  const endpoint = await db.webhookEndpoint.findFirstOrThrow({ where: { id: ids.endpoint, tenantId } });
  return [openSecret(key, integration.encryptedConfig, `${tenantId}/resend`), openSecret(key, endpoint.encryptedSecret, `${tenantId}/webhooks`)];
}

test('every secret is sealed again with the new key, unchanged, and the old key opens none of them', async () => {
  const [oldKey, nextKey] = [newKey(), newKey()];
  const ids = await seal(tenants.a, oldKey);
  const before = await opened(ids, oldKey, tenants.a);

  const { stdout } = await rotate(oldKey, nextKey, tenants.a);
  assert.match(stdout, /Re-sealed 2 secrets with the new key; 0 had it already/);
  assert.doesNotMatch(stdout, /re_|whsec_/, 'never prints a secret');
  assert.deepEqual(await opened(ids, nextKey, tenants.a), before);
  await assert.rejects(opened(ids, oldKey, tenants.a));

  // Run twice by mistake: nothing left to do.
  assert.match((await rotate(oldKey, nextKey, tenants.a)).stdout, /Re-sealed 0 secrets with the new key; 2 had it already/);
  assert.deepEqual(await opened(ids, nextKey, tenants.a), before);
});

test('a secret neither key opens stops the rotation, and nothing changes', async () => {
  const [oldKey, nextKey, stranger] = [newKey(), newKey(), newKey()];
  const good = await seal(tenants.b, oldKey);
  await db.tenantIntegration.create({ data: { tenantId: tenants.b, provider: 'fcm', maskedConfig: {}, encryptedConfig: sealSecret(stranger, '{}', `${tenants.b}/fcm`) } });

  await assert.rejects(rotate(oldKey, nextKey, tenants.b), /opens with neither key: nothing was changed/);
  assert.ok((await opened(good, oldKey, tenants.b)).length, 'still under the old key');

  await assert.rejects(rotate(oldKey, oldKey, tenants.b), /BYOK_MASTER_KEY_NEW is the current key/);
});
