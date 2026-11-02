import { z } from 'zod';
import { TenantTierSchema, TimestampSchema } from './common.js';

// "events", "active_players": what a module counts for billing.
export const MeterKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/);

// What a tier may use in a calendar month. A hard limit refuses more (429); a soft one only warns.
export const MeterQuotaSchema = z.object({ limit: z.number().int().positive(), hard: z.boolean() });
export type MeterQuota = z.infer<typeof MeterQuotaSchema>;

// A module declares its meters in its descriptor, like feature flags. Null: no limit on that tier.
export const MeterDefinitionSchema = z.object({
  key: MeterKeySchema,
  quotas: z.record(TenantTierSchema, MeterQuotaSchema.nullable()),
});
export type MeterDefinition = z.infer<typeof MeterDefinitionSchema>;

export const MeterUsageSchema = z.object({
  meter: MeterKeySchema,
  used: z.number().int(),
  limit: z.number().int().nullable(),
  // True while a hard limit is refusing more.
  refused: z.boolean(),
  periodStart: TimestampSchema,
});
export type MeterUsage = z.infer<typeof MeterUsageSchema>;

export const UsageListSchema = z.object({ meters: z.array(MeterUsageSchema) });
export type UsageList = z.infer<typeof UsageListSchema>;
