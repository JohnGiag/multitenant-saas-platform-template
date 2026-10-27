import { z } from 'zod';

// Only installed modules are listed; `enabled` says whether the current tenant has it switched on.
export const CapabilitySchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityResponseSchema = z.object({
  capabilities: z.array(CapabilitySchema),
});
export type CapabilityResponse = z.infer<typeof CapabilityResponseSchema>;
