import type { PaidTier, TenantTier } from '@repo/shared-types';

// A Stripe subscription as far as billing cares, already parsed from Stripe's JSON.
export interface Subscription {
  id: string;
  customerId: string;
  // Set by our Checkout (subscription_data.metadata): which tenant pays for it.
  tenantId: string | undefined;
  status: string;
  // When Stripe created the subscription: no event about it is older.
  created: Date;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  // When a scheduled cancellation takes effect; null if none.
  cancelAt: Date | null;
}

// What we last stored for the tenant.
export interface StoredSubscription {
  subscriptionId: string | null;
  status: string | null;
  lastEventAt: Date | null;
}

// A subscription in these states is over for good; a new checkout starts another one.
export const ENDED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);
export const hasEnded = (status: string | null) => status !== null && ENDED_STATUSES.has(status);

// The paid tier holds while Stripe is still retrying a failed payment (past_due): the tenant drops to free only when
// Stripe gives up and cancels, or marks the subscription unpaid. incomplete means the first payment never went through.
const PAID_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

export function tierOf({ status, priceId }: Pick<Subscription, 'status' | 'priceId'>, prices: Record<PaidTier, string>): TenantTier {
  if (!PAID_STATUSES.has(status)) return 'free';
  const tier = (Object.keys(prices) as PaidTier[]).find((t) => prices[t] === priceId);
  // A price we do not sell (removed from the configuration): no paid tier for it.
  return tier ?? 'free';
}

export type EventDecision = 'apply' | 'stale' | 'other_subscription';

// Stripe delivers events late, more than once and in any order, so each one is checked against what is stored:
// - an event older than the last one applied changes nothing;
// - once a subscription has ended, nothing about it changes any more (a late "updated" must not revive it);
// - another subscription replaces the stored one only if the stored one has ended (a new checkout after a
//   cancellation); otherwise it is a second subscription the tier does not follow.
export function decideEvent(stored: StoredSubscription, event: Subscription, createdAt: Date): EventDecision {
  if (stored.subscriptionId === null) return 'apply';
  if (event.id !== stored.subscriptionId) {
    return hasEnded(stored.status) && !hasEnded(event.status) ? 'apply' : 'other_subscription';
  }
  if (hasEnded(stored.status)) return 'stale';
  if (stored.lastEventAt && createdAt < stored.lastEventAt) return 'stale';
  return 'apply';
}
