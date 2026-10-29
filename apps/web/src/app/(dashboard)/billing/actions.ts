'use server';

import { BillingRedirectSchema, CreateCheckoutSchema, type BillingRedirect, type PaidTier } from '@repo/shared-types';
import { redirect } from 'next/navigation';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';

// Both send the browser to a Stripe-hosted page, which sends it back to /billing: card details never pass through
// the dashboard or the API.
async function goTo(call: () => Promise<BillingRedirect>): Promise<FormState> {
  let url: string;
  try {
    ({ url } = BillingRedirectSchema.parse(await call()));
  } catch (error) {
    return apiFailure(error);
  }
  redirect(url);
}

export async function startCheckout(tier: PaidTier): Promise<FormState> {
  const parsed = CreateCheckoutSchema.safeParse({ tier });
  if (!parsed.success) return invalid(parsed.error);
  return goTo(() => api<BillingRedirect>('/billing/checkout', { method: 'POST', body: parsed.data }));
}

export async function openPortal(): Promise<FormState> {
  return goTo(() => api<BillingRedirect>('/billing/portal', { method: 'POST' }));
}
