import { z } from 'zod';
import { IntegrationProviderSchema } from './integration.js';

// Only installed optional modules are listed; a deleted module simply disappears.
export const CapabilitySchema = z.object({
  key: z.string(),
  // The tenant integration that configures it (settings page target), or null if it needs none.
  integration: IntegrationProviderSchema.nullable(),
  // Whether the module is usable for the current tenant.
  enabled: z.boolean(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityResponseSchema = z.object({
  capabilities: z.array(CapabilitySchema),
});
export type CapabilityResponse = z.infer<typeof CapabilityResponseSchema>;
