import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invitationEmail, passwordResetEmail } from '../dist/modules/users/domain/emails.js';
import { appLink } from '../dist/modules/users/infrastructure/app-links.js';

test('email links keep a dashboard hosted under a path', () => {
  const link = (APP_URL) => appLink({ get: () => APP_URL }, 'accept-invitation', 'tok');
  assert.equal(link('https://example.com'), 'https://example.com/accept-invitation?token=tok');
  assert.equal(link('https://example.com/app'), 'https://example.com/app/accept-invitation?token=tok');
  assert.equal(link('https://example.com/app/'), 'https://example.com/app/accept-invitation?token=tok');
  assert.throws(() => link(undefined), /APP_URL is not set/);
});
import { decideMembershipChange } from '../dist/modules/users/domain/membership.js';
import { hashOneTimeToken, newOneTimeToken } from '../dist/modules/users/domain/one-time-token.js';

test('one-time tokens: 256 random bits, URL-safe, stored only as a stable SHA-256 hash', () => {
  const a = newOneTimeToken();
  const b = newOneTimeToken();
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash.length, 32);
  assert.deepEqual(hashOneTimeToken(a.token), a.hash);
  assert.notDeepEqual(hashOneTimeToken(b.token), a.hash);
});

test('emails carry the link and say how long it works', () => {
  const expiresAt = new Date('2026-11-03T10:00:00Z');
  const invite = invitationEmail({ tenantName: 'Acme', role: 'Auditor', link: 'https://app/x?token=t', expiresAt });
  assert.equal(invite.subject, "You're invited to Acme");
  assert.match(invite.text, /join Acme as Auditor/);
  assert.match(invite.text, /https:\/\/app\/x\?token=t/);
  assert.match(invite.text, /Tue, 03 Nov 2026 10:00:00 GMT/);
  const reset = passwordResetEmail({ tenantName: 'Acme', link: 'https://app/r?token=t' });
  assert.match(reset.text, /https:\/\/app\/r\?token=t/);
  assert.match(reset.text, /expires in 1 hour/);
});

test('SuperAdmin accounts are never changed or removed through the tenant API', () => {
  assert.equal(decideMembershipChange('SuperAdmin', 'User', 3), 'protected');
  assert.equal(decideMembershipChange('SuperAdmin', null, 3), 'protected');
});

test('the last TenantAdmin can be neither demoted nor removed', () => {
  assert.equal(decideMembershipChange('TenantAdmin', 'User', 0), 'last_admin');
  assert.equal(decideMembershipChange('TenantAdmin', null, 0), 'last_admin');
  assert.equal(decideMembershipChange('TenantAdmin', 'TenantAdmin', 0), 'ok');
  assert.equal(decideMembershipChange('TenantAdmin', 'User', 1), 'ok');
  assert.equal(decideMembershipChange('TenantAdmin', null, 1), 'ok');
});

test('other members change freely', () => {
  for (const role of ['User', 'Auditor']) {
    assert.equal(decideMembershipChange(role, 'TenantAdmin', 0), 'ok');
    assert.equal(decideMembershipChange(role, null, 0), 'ok');
  }
});
