import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clerkLoginStep } from './clerk-login-step.ts';

const accepts = (answer: boolean) => {
  const calls: number[] = [];
  return { calls, check: async () => (calls.push(1), answer) };
};

test('each Clerk session state gets its own /login step', async () => {
  const api = accepts(true);
  assert.equal(await clerkLoginStep({ userId: null }, api.check), 'sign-in');
  // Pending: signed in but owing Clerk the organization choice. Never the sign-in form again.
  assert.equal(await clerkLoginStep({ userId: 'u', orgId: null, sessionStatus: 'pending' }, api.check), 'organization-task');
  assert.equal(await clerkLoginStep({ userId: 'u', orgId: null, sessionStatus: 'active' }, api.check), 'choose-organization');
  // The API is only asked once there is an organization to ask about.
  assert.equal(api.calls.length, 0);
});

test('a complete session goes to the dashboard only if the API knows it; otherwise no redirect loop', async () => {
  const known = accepts(true);
  assert.equal(await clerkLoginStep({ userId: 'u', orgId: 'o', sessionStatus: 'active' }, known.check), 'dashboard');
  assert.equal(known.calls.length, 1);
  assert.equal(await clerkLoginStep({ userId: 'u', orgId: 'o', sessionStatus: 'active' }, accepts(false).check), 'not-set-up');
});
