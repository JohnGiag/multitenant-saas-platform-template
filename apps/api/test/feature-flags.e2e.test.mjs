import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { FeatureFlagResponseSchema } from '@repo/shared-types';
import { FEATURE_FLAG_REPOSITORY } from '../dist/modules/feature-flags/domain/ports/feature-flag.repository.js';
import { loadOptionalModules } from '../dist/modules/system/infrastructure/optional-module-loader.js';
import { cleanup, db, FIXTURES, seedTenant, startApp } from './helpers.mjs';

const tenants = {};
const tokens = {};
let app, call;

before(async () => {
  tenants.platform = await seedTenant('flags-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('flags-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('flags-e2e-b', { admin: 'TenantAdmin' });
  await db.tenant.update({ where: { id: tenants.platform }, data: { tier: 'enterprise' } });
  let login;
  ({ app, call, login } = await startApp({ optionalModulesDir: join(FIXTURES, 'optional-flags') }));
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(() => cleanup(app, Object.values(tenants)));

// Every test starts from free tenants without overrides.
beforeEach(async () => {
  await db.tenantFeatureFlag.deleteMany({ where: { tenantId: { in: [tenants.a, tenants.b] } } });
  await db.tenant.updateMany({ where: { id: { in: [tenants.a, tenants.b] } }, data: { tier: 'free' } });
});

const setTier = (id, tier) => db.tenant.update({ where: { id }, data: { tier } });
const override = (key, state, tenant = tenants.a) => call('PUT', `/feature-flags/${key}/${state}`, { token: tokens.super, tenant });
const clear = (key, tenant = tenants.a) => call('DELETE', `/feature-flags/${key}`, { token: tokens.super, tenant });
const streaksStatus = async (token, tenant) => (await call('GET', '/gated/streaks', { token, tenant })).status;

async function flags(token, tenant) {
  const res = await call('GET', '/feature-flags', { token, tenant });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(FeatureFlagResponseSchema.parse(body), body, 'response does not match shared schema');
  return Object.fromEntries(body.flags.map((f) => [f.key, f]));
}

test('every role reads the flags of its tenant: tier defaults, nothing overridden', async () => {
  for (const token of [tokens.adminA, tokens.userA, tokens.auditorA]) {
    assert.deepEqual(await flags(token), {
      everyone: { key: 'everyone', minTier: 'free', override: null, enabled: true },
      'private-beta': { key: 'private-beta', minTier: null, override: null, enabled: false },
      streaks: { key: 'streaks', minTier: 'pro', override: null, enabled: false },
    });
  }
  assert.equal((await call('GET', '/feature-flags')).status, 401);
});

test('a tier change applies at once, even to a token issued under the old tier', async () => {
  assert.equal(await streaksStatus(tokens.userA), 403);
  await setTier(tenants.a, 'pro');
  assert.equal(await streaksStatus(tokens.userA), 200, 'the token still says free');
  await setTier(tenants.a, 'free');
  assert.equal(await streaksStatus(tokens.userA), 403);
});

test('a disabled feature answers 403 and names the feature', async () => {
  const res = await call('GET', '/gated/streaks', { token: tokens.userA });
  assert.equal(res.status, 403);
  assert.match((await res.json()).message, /streaks/);
});

test('an override beats the tier both ways, survives tier changes, and clearing it restores the tier', async () => {
  assert.equal((await override('streaks', 'on')).status, 204);
  assert.equal(await streaksStatus(tokens.userA), 200, 'on, for a free tenant');
  assert.equal((await flags(tokens.userA)).streaks.override, true);

  await setTier(tenants.a, 'enterprise');
  assert.equal((await override('streaks', 'off')).status, 204);
  assert.equal(await streaksStatus(tokens.userA), 403, 'off, for an enterprise tenant');

  await setTier(tenants.a, 'pro');
  assert.equal(await streaksStatus(tokens.userA), 403, 'the override outlives the tier change');

  assert.equal((await clear('streaks')).status, 204);
  assert.equal(await streaksStatus(tokens.userA), 200, 'back to what pro gives');
  assert.equal((await flags(tokens.userA)).streaks.override, null);
});

test('a flag no tier gets is reachable only through an override', async () => {
  await setTier(tenants.a, 'enterprise');
  assert.equal((await flags(tokens.userA))['private-beta'].enabled, false);
  await override('private-beta', 'on');
  assert.equal((await flags(tokens.userA))['private-beta'].enabled, true);
});

test('only a SuperAdmin sets overrides: not a TenantAdmin, not its API keys, not anyone below', async () => {
  const created = await call('POST', '/api-keys', { token: tokens.adminA, body: { name: 'flags', role: 'TenantAdmin' } });
  assert.equal(created.status, 201);
  const { key } = await created.json();

  for (const [method, path] of [['PUT', '/feature-flags/streaks/on'], ['PUT', '/feature-flags/streaks/off'], ['DELETE', '/feature-flags/streaks']]) {
    for (const token of [tokens.adminA, tokens.userA, tokens.auditorA]) {
      assert.equal((await call(method, path, { token })).status, 403, `${method} ${path}`);
    }
    assert.equal((await call(method, path, { apiKey: key })).status, 403, `${method} ${path} with an API key`);
    assert.equal((await call(method, path)).status, 401);
  }
  assert.equal(await db.tenantFeatureFlag.count({ where: { tenantId: tenants.a } }), 0);
});

test("tenant A cannot read or write tenant B's flags", async () => {
  await override('streaks', 'on', tenants.a);
  assert.equal(await streaksStatus(tokens.adminA), 200);
  assert.equal(await streaksStatus(tokens.adminB), 403);
  assert.equal((await flags(tokens.adminB)).streaks.override, null);

  // X-Tenant-Id is a SuperAdmin's alone.
  assert.equal((await call('GET', '/feature-flags', { token: tokens.adminA, tenant: tenants.b })).status, 403);
  assert.equal((await call('GET', '/gated/streaks', { token: tokens.adminA, tenant: tenants.b })).status, 403);

  // Clearing B's override leaves A's.
  assert.equal((await clear('streaks', tenants.b)).status, 204);
  assert.equal(await streaksStatus(tokens.adminA), 200);
});

test('the repository keeps each tenant to its own rows', async () => {
  const repository = app.get(FEATURE_FLAG_REPOSITORY, { strict: false });
  await repository.setOverride(tenants.a, 'streaks', true);
  await repository.setOverride(tenants.b, 'streaks', false);

  assert.equal((await repository.load(tenants.a)).overrides.get('streaks'), true);
  assert.equal((await repository.load(tenants.b)).overrides.get('streaks'), false);

  await repository.clearOverride(tenants.b, 'streaks');
  assert.equal((await repository.load(tenants.b)).overrides.size, 0);
  assert.equal((await repository.load(tenants.a)).overrides.get('streaks'), true);
});

test('under X-Tenant-Id a flag follows the target tenant, not the SuperAdmin tier', async () => {
  assert.equal(await streaksStatus(tokens.super), 200, 'its own tenant is enterprise');
  assert.equal(await streaksStatus(tokens.super, tenants.a), 403, 'tenant A is free');
  assert.equal((await flags(tokens.super, tenants.a)).streaks.enabled, false);

  await setTier(tenants.a, 'pro');
  assert.equal(await streaksStatus(tokens.super, tenants.a), 200);
});

test('a flag being on never lets a SuperAdmin into a route its @Roles leave it out of', async () => {
  assert.equal((await call('GET', '/gated/business', { token: tokens.adminA })).status, 200);
  assert.equal((await call('GET', '/gated/business', { token: tokens.super, tenant: tenants.a })).status, 403);
});

test('an SSE route is refused before its stream starts', async () => {
  const res = await call('GET', '/gated/stream', { token: tokens.userA });
  assert.equal(res.status, 403);
  assert.match(res.headers.get('content-type'), /json/);

  await setTier(tenants.a, 'pro');
  const allowed = await call('GET', '/gated/stream', { token: tokens.userA });
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get('content-type'), /event-stream/);
  await allowed.body.cancel();
});

test('overrides are for declared flags; a leftover row of an uninstalled module is ignored and can be removed', async () => {
  assert.equal((await override('no-such-flag', 'on')).status, 404);
  assert.equal((await override('Not_Valid', 'on')).status, 400);

  await db.tenantFeatureFlag.create({ data: { tenantId: tenants.a, key: 'uninstalled', enabled: true } });
  assert.equal((await flags(tokens.adminA)).uninstalled, undefined);
  assert.equal((await clear('uninstalled')).status, 204);
  assert.equal(await db.tenantFeatureFlag.count({ where: { tenantId: tenants.a } }), 0);
});

test('a route gated by an undeclared flag fails loudly instead of looking switched off', async () => {
  assert.equal((await call('GET', '/gated/typo', { token: tokens.userA })).status, 500);
});

test('the audit log shows who changed which flag, which way, for which tenant', async () => {
  await override('streaks', 'on');
  await override('streaks', 'off');
  await clear('streaks');
  const rows = await db.auditLog.findMany({
    where: { tenantId: tenants.platform, actedOnTenantId: tenants.a, targetId: 'streaks' },
    orderBy: { id: 'desc' },
    take: 3,
  });
  assert.deepEqual(rows.map((r) => [r.method, r.route, r.actorRole, r.status]).reverse(), [
    ['PUT', '/v1/feature-flags/:id/on', 'SuperAdmin', 204],
    ['PUT', '/v1/feature-flags/:id/off', 'SuperAdmin', 204],
    ['DELETE', '/v1/feature-flags/:id', 'SuperAdmin', 204],
  ]);
});

test("deleting a tenant erases its overrides, and only its", async () => {
  const doomed = await seedTenant('flags-e2e-doomed');
  await override('streaks', 'on', doomed);
  await override('streaks', 'on', tenants.a);
  assert.equal((await call('DELETE', `/tenants/${doomed}`, { token: tokens.super })).status, 204);
  assert.equal(await db.tenantFeatureFlag.count({ where: { tenantId: doomed } }), 0);
  assert.equal(await db.tenantFeatureFlag.count({ where: { tenantId: tenants.a } }), 1);
});

test('two modules declaring the same flag stop startup', async () => {
  await assert.rejects(loadOptionalModules(join(FIXTURES, 'optional-duplicate-flag')), /Feature flag "shared" is declared twice/);
});
