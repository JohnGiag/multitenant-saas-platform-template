import { z } from 'zod';
import { EmailSchema, IdSchema, RoleSchema, TenantTierSchema, TimestampSchema } from './common.js';

// Email and password are enough: emails are unique per tenant, not globally, so when the password matches
// accounts in several tenants the API answers with a TenantChoice and the client signs in again with
// the chosen `tenantId`.
export const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(256),
  tenantId: IdSchema.optional(),
});
export type SignInDto = z.infer<typeof SignInSchema>;

export const AuthTokenSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});
export type AuthToken = z.infer<typeof AuthTokenSchema>;

// Only tenants whose account accepted the password, so it reveals nothing to someone without it.
export const TenantChoiceSchema = z.object({
  tenants: z.array(z.object({ id: IdSchema, name: z.string() })).min(2),
});
export type TenantChoice = z.infer<typeof TenantChoiceSchema>;

export const SignInResultSchema = z.union([AuthTokenSchema, TenantChoiceSchema]);
export type SignInResult = z.infer<typeof SignInResultSchema>;

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
