import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Capability } from '@repo/shared-types';
import { capabilityTitle, configurableCapabilities } from './capabilities.ts';

const capabilities: Capability[] = [
  { key: 'email', integration: 'resend', enabled: false },
  { key: 'webhooks', integration: null, enabled: true },
];

test('only TenantAdmin and Auditor get tabs, and only for modules that take an integration', () => {
  assert.deepEqual(configurableCapabilities(capabilities, 'TenantAdmin').map((c) => c.key), ['email']);
  assert.deepEqual(configurableCapabilities(capabilities, 'Auditor').map((c) => c.key), ['email']);
  // SuperAdmin never sees a tenant's secrets; a User has nothing to configure.
  assert.deepEqual(configurableCapabilities(capabilities, 'SuperAdmin'), []);
  assert.deepEqual(configurableCapabilities(capabilities, 'User'), []);
});

test('capability keys become titles', () => {
  assert.equal(capabilityTitle('push-notifications'), 'Push notifications');
});
