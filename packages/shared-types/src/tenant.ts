import { z } from 'zod';
import { IdSchema, TenantTierSchema, TimestampSchema } from './common.js';

export const TenantSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tier: TenantTierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Tenant = z.infer<typeof TenantSchema>;

// No tier: it is set by billing/SuperAdmin, never chosen by the caller.
export const CreateTenantSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
