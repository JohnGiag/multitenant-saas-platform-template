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
  // Single use: swap it at POST /v1/auth/refresh for a new pair, and keep the new one.
  refreshToken: z.string(),
  refreshExpiresIn: z.number().int(),
});
export type AuthToken = z.infer<typeof AuthTokenSchema>;

export const RefreshTokenSchema = z.object({ refreshToken: z.string().min(1).max(300) });
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;

// Only tenants whose account accepted the password, so it reveals nothing to someone without it.
export const TenantChoiceSchema = z.object({
  tenants: z.array(z.object({ id: IdSchema, name: z.string() })).min(2),
});
export type TenantChoice = z.infer<typeof TenantChoiceSchema>;

export const SignInResultSchema = z.union([AuthTokenSchema, TenantChoiceSchema]);
export type SignInResult = z.infer<typeof SignInResultSchema>;

// What every API key can be limited to; modules add their own scopes with ApiScopes.declare.
export const CORE_API_SCOPES = ['read', 'write'] as const;
export const ApiKeyModeSchema = z.enum(['live', 'test']);
export type ApiKeyMode = z.infer<typeof ApiKeyModeSchema>;

// Who is making the request: a signed-in user or a headless client holding an API key.
export const PrincipalSchema = z.object({
  kind: z.enum(['user', 'apiKey']),
  id: IdSchema,
  tenantId: IdSchema,
  role: RoleSchema,
  // The caller's own tenant tier; it sets their rate limit.
  tier: TenantTierSchema,
  // API keys only.
  scopes: z.array(z.string()).optional(),
  mode: ApiKeyModeSchema.optional(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: RoleSchema.exclude(['SuperAdmin']).optional(),
  // Left out: the core scopes.
  scopes: z.array(z.string().min(1).max(50)).min(1).max(20).optional(),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;

// `key` is the only time the plaintext key is ever returned.
export const CreatedApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: RoleSchema,
  scopes: z.array(z.string()),
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
  scopes: z.array(z.string()),
  prefix: z.string(),
  createdAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummarySchema>;

export const ApiScopeListSchema = z.object({ scopes: z.array(z.string()) });
export type ApiScopeList = z.infer<typeof ApiScopeListSchema>;
