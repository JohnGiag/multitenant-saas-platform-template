import type { MeterDefinition, MeterQuota, TenantTier } from '@repo/shared-types';

const HOUR_MS = 60 * 60 * 1000;
// Percentages of a quota at which a tenant is told.
const THRESHOLDS = [80, 100];

export const hourStart = (now: Date) => new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
export const periodStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextPeriodStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export const quotaOf = (definition: MeterDefinition, tier: TenantTier): MeterQuota | null => definition.quotas[tier] ?? null;

// Whether spending `quantity` more would pass a hard limit.
export const isRefused = (used: number, quota: MeterQuota | null, quantity = 1) =>
  quota !== null && quota.hard && used + quantity > quota.limit;

// The thresholds this addition went past. Counters are atomic, so of concurrent additions exactly one crosses each.
export const crossedThresholds = (before: number, after: number, limit: number): number[] =>
  THRESHOLDS.filter((percent) => before * 100 < percent * limit && after * 100 >= percent * limit);
