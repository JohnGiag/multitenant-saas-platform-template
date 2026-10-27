import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';

// Free-form key (e.g. "resend", "r2") so optional modules add providers without touching this package.
export const IntegrationProviderSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

// Never carries the encrypted or decrypted config, only masked values.
export const TenantIntegrationSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  provider: IntegrationProviderSchema,
  enabled: z.boolean(),
  maskedConfig: z.record(z.string(), z.string()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TenantIntegration = z.infer<typeof TenantIntegrationSchema>;

// The provider comes from the URL; this is the body that replaces its config.
export const UpsertTenantIntegrationSchema = z.object({
  config: z
    .record(z.string().min(1).max(64), z.string().max(16_384))
    .refine((c) => Object.keys(c).length > 0, 'Config must not be empty'),
  enabled: z.boolean().optional(),
});
export type UpsertTenantIntegrationDto = z.infer<typeof UpsertTenantIntegrationSchema>;

export const IntegrationPageQuerySchema = pageQuery(IntegrationProviderSchema);
export type IntegrationPageQuery = z.infer<typeof IntegrationPageQuerySchema>;
