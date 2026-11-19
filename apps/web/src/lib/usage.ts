import type { MeterUsage } from '@repo/shared-types';
import type { Translate } from './translate';

export type UsageState = 'unlimited' | 'within' | 'near' | 'over' | 'refused';

// Where the API starts telling a tenant by email, too.
const NEAR_PERCENT = 80;

export function usageState({ used, limit, refused }: MeterUsage): UsageState {
  if (refused) return 'refused';
  if (limit === null) return 'unlimited';
  if (used >= limit) return 'over';
  return used * 100 >= limit * NEAR_PERCENT ? 'near' : 'within';
}

// A meter's name in the reader's language: `meter.<key>`, which the module that declares it adds for every locale. The
// key itself until then, rather than the untranslated message key.
export function meterName(t: Translate, key: string): string {
  const name = t(`meter.${key}`);
  return name === `meter.${key}` ? key : name;
}

export const needsAttention = (meters: readonly MeterUsage[]) => meters.some((meter) => ['near', 'over', 'refused'].includes(usageState(meter)));
