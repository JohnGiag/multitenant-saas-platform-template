import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsAttention, usageState } from './usage.ts';

const meter = (used: number, limit: number | null, refused = false) => ({ meter: 'events', used, limit, refused, periodStart: '2026-11-01T00:00:00.000Z' });

test('a meter is within its limit, near it from 80%, then over it; a hard limit is refused', () => {
  assert.equal(usageState(meter(79, 100)), 'within');
  assert.equal(usageState(meter(80, 100)), 'near');
  assert.equal(usageState(meter(100, 100)), 'over');
  assert.equal(usageState(meter(100, 100, true)), 'refused');
  assert.equal(usageState(meter(1_000_000, null)), 'unlimited');
});

test('the banner shows when any meter needs attention', () => {
  assert.equal(needsAttention([]), false);
  assert.equal(needsAttention([meter(1, 100), meter(5, null)]), false);
  assert.equal(needsAttention([meter(1, 100), meter(90, 100)]), true);
});
