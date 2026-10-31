import { z } from 'zod';
import { TenantTierSchema } from './common.js';

export const FeatureFlagKeySchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

// Declared in code by the module that owns the feature (OptionalModule.featureFlags).
export const FeatureFlagDefinitionSchema = z.object({
  key: FeatureFlagKeySchema,
  // The lowest tier that gets the feature by default; null: nobody, until a tenant gets an override.
  minTier: TenantTierSchema.nullable(),
});
export type FeatureFlagDefinition = z.infer<typeof FeatureFlagDefinitionSchema>;

export const FeatureFlagSchema = FeatureFlagDefinitionSchema.extend({
  // A SuperAdmin's decision for this tenant, which beats the tier; null if there is none.
  override: z.boolean().nullable(),
  enabled: z.boolean(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FeatureFlagResponseSchema = z.object({
  flags: z.array(FeatureFlagSchema),
});
export type FeatureFlagResponse = z.infer<typeof FeatureFlagResponseSchema>;
