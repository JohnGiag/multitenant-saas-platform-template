import { z } from 'zod';
import { IdSchema, TenantTierSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';

export const TenantSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tier: TenantTierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Tenant = z.infer<typeof TenantSchema>;

const TenantNameSchema = z.string().trim().min(1).max(100);

// No tier: it is set by billing/SuperAdmin, never chosen by the caller.
export const CreateTenantSchema = z.object({ name: TenantNameSchema });
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;

// What a tenant may change about itself.
export const UpdateTenantSchema = z.object({ name: TenantNameSchema });
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;

// What a SuperAdmin may change about any tenant.
export const AdminUpdateTenantSchema = z
  .object({ name: TenantNameSchema.optional(), tier: TenantTierSchema.optional() })
  .refine((v) => v.name !== undefined || v.tier !== undefined, 'Nothing to update');
export type AdminUpdateTenantDto = z.infer<typeof AdminUpdateTenantSchema>;

export const TenantPageQuerySchema = pageQuery(IdSchema);
export type TenantPageQuery = z.infer<typeof TenantPageQuerySchema>;
