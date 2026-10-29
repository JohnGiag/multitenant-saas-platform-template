import { z } from 'zod';
import { TenantTierSchema, TimestampSchema } from './common.js';

// The tiers a subscription can buy; `free` is what a tenant has without one.
export const PaidTierSchema = TenantTierSchema.exclude(['free']);
export type PaidTier = z.infer<typeof PaidTierSchema>;

// GET /v1/billing: the tenant's tier and, once it has subscribed, the subscription as Stripe last reported it.
export const BillingStatusSchema = z.object({
  tier: TenantTierSchema,
  // Stripe's subscription status (e.g. "active", "past_due", "canceled"); null before the first subscription.
  status: z.string().nullable(),
  // When the paid period now running ends (the next renewal).
  currentPeriodEnd: TimestampSchema.nullable(),
  // Set once a cancellation is scheduled: the tier stays until then, and drops to free at that time.
  cancelAt: TimestampSchema.nullable(),
});
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

export const CreateCheckoutSchema = z.object({ tier: PaidTierSchema });

// Back from Stripe Checkout: the session id Stripe put in the return link, so the plan applies without waiting
// for the webhook.
export const ConfirmCheckoutSchema = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]{1,250}$/) });
export type ConfirmCheckoutDto = z.infer<typeof ConfirmCheckoutSchema>;
export type CreateCheckoutDto = z.infer<typeof CreateCheckoutSchema>;

// A Stripe-hosted page (Checkout or the Customer Portal) to send the browser to.
export const BillingRedirectSchema = z.object({ url: z.url() });
export type BillingRedirect = z.infer<typeof BillingRedirectSchema>;
