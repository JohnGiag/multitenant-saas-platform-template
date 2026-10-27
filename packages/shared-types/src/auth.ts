import { z } from 'zod';
import { EmailSchema, IdSchema, RoleSchema, TenantTierSchema, TimestampSchema } from './common.js';

// Emails are unique per tenant, so sign-in names the tenant.
export const SignInSchema = z.object({
  tenantId: IdSchema,
  email: EmailSchema,
  password: z.string().min(1).max(256),
});
export type SignInDto = z.infer<typeof SignInSchema>;

export const AuthTokenSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});
export type AuthToken = z.infer<typeof AuthTokenSchema>;

// Who is making the request: a signed-in user or a headless client holding an API key.
export const PrincipalSchema = z.object({
  kind: z.enum(['user', 'apiKey']),
  id: IdSchema,
  tenantId: IdSchema,
  role: RoleSchema,
  // The caller's own tenant tier; it sets their rate limit.
  tier: TenantTierSchema,
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: RoleSchema.exclude(['SuperAdmin']).optional(),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;

// `key` is the only time the plaintext key is ever returned.
export const CreatedApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: RoleSchema,
  prefix: z.string(),
  key: z.string(),
  createdAt: TimestampSchema,
});
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;

// Listing shape: never the key or its hash.
export const ApiKeySummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: RoleSchema,
  prefix: z.string(),
  createdAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummarySchema>;
