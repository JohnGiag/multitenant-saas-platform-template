import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CreateTenantSchema, CreateUserSchema, IntegrationProviderSchema, UserSchema } from '../dist/index.js';

test('CreateTenant drops a caller-chosen tier', () => {
  assert.equal('tier' in CreateTenantSchema.parse({ name: 'Acme', tier: 'enterprise' }), false);
});

test('emails are normalised to lowercase', () => {
  assert.equal(CreateUserSchema.parse({ email: 'Ada@Example.COM' }).email, 'ada@example.com');
});

test('SuperAdmin cannot be assigned through CreateUser', () => {
  assert.equal(CreateUserSchema.safeParse({ email: 'a@b.co', role: 'SuperAdmin' }).success, false);
  assert.equal(CreateUserSchema.safeParse({ email: 'a@b.co', role: 'TenantAdmin' }).success, true);
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
