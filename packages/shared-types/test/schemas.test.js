import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcceptInvitationSchema,
  AdminUpdateTenantSchema,
  ChangePasswordSchema,
  CreateInvitationSchema,
  CreateTenantSchema,
  IntegrationProviderSchema,
  PasswordResetConfirmSchema,
  SendNotificationSchema,
  TenantPageQuerySchema,
  UpdateTenantSchema,
  UpdateUserSchema,
  UpsertTenantIntegrationSchema,
  UserSchema,
} from '../dist/index.js';

test('notification data rejects keys and sizes that FCM would refuse', () => {
  const base = { userId: '01a17d01-acd3-775a-a34d-efdb20d0a988', title: 't', body: 'b' };
  const ok = (data) => SendNotificationSchema.safeParse({ ...base, data }).success;
  assert.ok(ok({ orderId: '42', fromAddress: 'x', googleish: 'y' }));
  for (const key of ['from', 'notification', 'message_type', 'google.c.a', 'gcm.n.e']) {
    assert.ok(!ok({ [key]: 'x' }), key);
  }
  assert.ok(ok({ a: 'x'.repeat(1000) }));
  assert.ok(!ok({ a: 'x'.repeat(1000), b: 'y'.repeat(100) }), 'over 1024 bytes');
  assert.ok(!ok({ a: 'é'.repeat(600) }), 'bytes, not characters');
});

test('tenants cannot change their own tier', () => {
  assert.equal('tier' in UpdateTenantSchema.parse({ name: 'Acme', tier: 'enterprise' }), false);
  assert.equal(AdminUpdateTenantSchema.safeParse({}).success, false);
  assert.deepEqual(AdminUpdateTenantSchema.parse({ tier: 'pro' }), { tier: 'pro' });
});

test('page query coerces limit from the query string and bounds it', () => {
  assert.deepEqual(TenantPageQuerySchema.parse({}), { limit: 20 });
  assert.equal(TenantPageQuerySchema.parse({ limit: '5' }).limit, 5);
  for (const limit of ['0', '101', '2.5', 'abc']) {
    assert.equal(TenantPageQuerySchema.safeParse({ limit }).success, false, limit);
  }
  assert.equal(TenantPageQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success, false);
});

test('integration config must not be empty', () => {
  assert.equal(UpsertTenantIntegrationSchema.safeParse({ config: {} }).success, false);
  assert.equal(UpsertTenantIntegrationSchema.safeParse({ config: { apiKey: 'x' } }).success, true);
});

test('CreateTenant drops a caller-chosen tier', () => {
  assert.equal('tier' in CreateTenantSchema.parse({ name: 'Acme', tier: 'enterprise' }), false);
});

const password = 'correct horse battery';

test('emails are normalised to lowercase', () => {
  assert.equal(CreateInvitationSchema.parse({ email: 'Ada@Example.COM' }).email, 'ada@example.com');
});

test('SuperAdmin cannot be assigned through user input', () => {
  assert.equal(CreateInvitationSchema.safeParse({ email: 'a@b.co', role: 'SuperAdmin' }).success, false);
  assert.equal(CreateInvitationSchema.safeParse({ email: 'a@b.co', role: 'TenantAdmin' }).success, true);
  assert.equal(UpdateUserSchema.safeParse({ role: 'SuperAdmin' }).success, false);
  assert.equal(UpdateUserSchema.safeParse({ role: 'Auditor' }).success, true);
});

test('invitations never carry a password; whoever sets one needs at least 12 characters', () => {
  assert.equal('password' in CreateInvitationSchema.parse({ email: 'a@b.co', password }), false);
  for (const schema of [AcceptInvitationSchema, PasswordResetConfirmSchema]) {
    assert.equal(schema.safeParse({ token: 't', password: 'too short' }).success, false);
    assert.equal(schema.safeParse({ token: 't', password }).success, true);
  }
  assert.equal(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'too short' }).success, false);
  assert.equal(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: password }).success, true);
});

test('UserSchema strips unknown fields such as passwordHash', () => {
  const user = UserSchema.parse({
    id: '01a17d01-acd3-775a-a34d-efdb20d0a988',
    tenantId: '01a17d01-acd3-775a-a34d-efdb20d0a989',
    email: 'a@b.co',
    role: 'User',
    passwordHash: 'secret',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
  });
  assert.equal('passwordHash' in user, false);
});

test('integration provider keys are restricted', () => {
  assert.equal(IntegrationProviderSchema.safeParse('resend').success, true);
  assert.equal(IntegrationProviderSchema.safeParse('Resend Mail').success, false);
});
