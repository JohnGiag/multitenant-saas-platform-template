import type { BillingStatus, PaidTier } from '@repo/shared-types';
import type { Subscription } from '../subscription.js';

export const BILLING_SERVICE = Symbol('BillingService');

export interface BillingService {
  // Stripe's signing secret for the webhook; null while billing is off.
  readonly webhookSecret: string | null;
  status(tenantId: string): Promise<BillingStatus>;
  // A Stripe Checkout page that starts the subscription. Throws BillingConflictError if one is already running.
  checkout(tenantId: string, tier: PaidTier): Promise<string>;
  // Back from Checkout: applies the session's subscription now rather than when its webhook arrives. Idempotent.
  confirmCheckout(tenantId: string, sessionId: string): Promise<BillingStatus>;
  // The Stripe Customer Portal: change plan, payment method, cancel, invoices.
  portal(tenantId: string): Promise<string>;
  // A verified webhook's subscription, created by Stripe at `createdAt`. Safe to receive twice and out of order.
  applySubscription(subscription: Subscription, createdAt: Date): Promise<void>;
}

export class BillingNotConfiguredError extends Error {}
export class BillingConflictError extends Error {}
export class BillingNotFoundError extends Error {}
