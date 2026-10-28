import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuditFilterFormSchema } from './audit-filter.ts';

test('"From" starts its UTC day; "To" includes its own day', () => {
  assert.deepEqual(AuditFilterFormSchema.parse({ from: '2026-10-01', to: '2026-10-04' }), {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-05T00:00:00.000Z',
  });
  // Across a month end.
  assert.equal(AuditFilterFormSchema.parse({ to: '2026-10-31' }).to, '2026-11-01T00:00:00.000Z');
});

test('invalid dates and partial ids are refused', () => {
  assert.equal(AuditFilterFormSchema.safeParse({ from: '2026-02-30' }).success, false);
  assert.equal(AuditFilterFormSchema.safeParse({ to: '2026-10-01T00:00:00Z' }).success, false);
  assert.equal(AuditFilterFormSchema.safeParse({ actorId: '0199' }).success, false);
});
