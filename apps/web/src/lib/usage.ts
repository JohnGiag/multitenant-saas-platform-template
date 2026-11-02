import type { MeterUsage } from '@repo/shared-types';

export type UsageState = 'unlimited' | 'within' | 'near' | 'over' | 'refused';

// Where the API starts telling a tenant by email, too.
const NEAR_PERCENT = 80;

export function usageState({ used, limit, refused }: MeterUsage): UsageState {
  if (refused) return 'refused';
  if (limit === null) return 'unlimited';
  if (used >= limit) return 'over';
  return used * 100 >= limit * NEAR_PERCENT ? 'near' : 'within';
}

export const needsAttention = (meters: readonly MeterUsage[]) => meters.some((meter) => ['near', 'over', 'refused'].includes(usageState(meter)));
