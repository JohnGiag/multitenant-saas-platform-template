import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeatureFlags, resolveFlag } from '../dist/modules/feature-flags/domain/feature-flags.js';

test('without an override, a flag is on from its minTier upwards', () => {
  const expected = {
    free: { free: true, pro: true, enterprise: true },
    pro: { free: false, pro: true, enterprise: true },
    enterprise: { free: false, pro: false, enterprise: true },
  };
  for (const [minTier, byTier] of Object.entries(expected)) {
    for (const [tier, enabled] of Object.entries(byTier)) {
      assert.equal(resolveFlag({ key: 'x', minTier }, tier, undefined), enabled, `minTier ${minTier}, tier ${tier}`);
    }
  }
});

test('a null minTier is off for every tier, until an override', () => {
  for (const tier of ['free', 'pro', 'enterprise']) assert.equal(resolveFlag({ key: 'x', minTier: null }, tier, undefined), false);
  assert.equal(resolveFlag({ key: 'x', minTier: null }, 'free', true), true);
});

test('an override beats the tier in both directions', () => {
  assert.equal(resolveFlag({ key: 'x', minTier: 'enterprise' }, 'free', true), true);
  assert.equal(resolveFlag({ key: 'x', minTier: 'free' }, 'enterprise', false), false);
});

const definitions = [
  { key: 'zebra', minTier: 'free' },
  { key: 'alpha', minTier: 'pro' },
];
const flagsOf = (state) => new FeatureFlags(definitions, { load: async () => state });

test('lists declared flags in order, and ignores overrides of flags no module declares', async () => {
  const flags = await flagsOf({ tier: 'free', overrides: new Map([['alpha', true], ['uninstalled', true]]) }).list('tenant');
  assert.deepEqual(flags, [
    { key: 'alpha', minTier: 'pro', override: true, enabled: true },
    { key: 'zebra', minTier: 'free', override: null, enabled: true },
  ]);
});

test('a tenant that no longer exists has no features, whatever the default', async () => {
  assert.equal(await flagsOf(null).isEnabled('gone', 'zebra'), false);
  assert.deepEqual(await flagsOf(null).list('gone'), []);
});

test('checking a flag nobody declares is a bug, not a feature that is off', async () => {
  await assert.rejects(flagsOf({ tier: 'free', overrides: new Map() }).isEnabled('tenant', 'typo'), /"typo" is not declared/);
});
