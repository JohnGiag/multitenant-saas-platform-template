import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAuthProvider } from './auth-mode.ts';

test('AUTH_PROVIDER is local by default, clerk when asked, and nothing else', () => {
  assert.equal(parseAuthProvider(undefined), 'local');
  assert.equal(parseAuthProvider(''), 'local');
  assert.equal(parseAuthProvider('clerk'), 'clerk');
  // A typo must not silently fall back to local while the API runs in Clerk mode.
  assert.throws(() => parseAuthProvider('clerck'), /Unknown AUTH_PROVIDER "clerck"/);
});
