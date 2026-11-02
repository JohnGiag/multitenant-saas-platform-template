import { IdSchema } from '@repo/shared-types';
import { z } from 'zod';
import type { Subscription } from '../domain/subscription.js';

const STRIPE_API = 'https://api.stripe.com/v1';
// A hung Stripe would otherwise hold the request (or a worker slot) for undici's 5-minute default.
const TIMEOUT_MS = 10_000;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

// The few Stripe calls billing makes, as form-encoded requests (Stripe's API takes no JSON bodies). No API version is
// pinned: the account's default applies, and the parsing below accepts both the older and the 2025+ shapes.
export class StripeApi {
  constructor(private readonly secretKey: string) {}

  // The idempotency key makes concurrent first checkouts of one tenant share one customer.
  async createCustomer(tenantId: string, name: string): Promise<string> {
    const body = { name, 'metadata[tenantId]': tenantId };
    return (await this.call<{ id: string }>('POST', '/customers', body, `customer-${tenantId}`)).id;
  }

  async createCheckoutSession(input: { customerId: string; priceId: string; tenantId: string; successUrl: string; cancelUrl: string }) {
    const body = {
      mode: 'subscription',
      customer: input.customerId,
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: input.tenantId,
      // Every event about the subscription carries it, which is how webhooks find the tenant.
      'subscription_data[metadata][tenantId]': input.tenantId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
    return (await this.call<{ url: string }>('POST', '/checkout/sessions', body)).url;
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    return (await this.call<{ url: string }>('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl })).url;
  }

  // With the subscription expanded, so it arrives in full (the same object webhooks carry).
  async retrieveCheckoutSession(sessionId: string): Promise<unknown> {
    return this.call('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`);
  }

  // Cancels at once (no proration or refund): used on a second subscription the tier does not follow.
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.call('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  // Also cancels every subscription of the customer at once; Stripe keeps its past invoices.
  async deleteCustomer(customerId: string): Promise<void> {
    await this.call('DELETE', `/customers/${encodeURIComponent(customerId)}`);
  }

  // `identifier` makes Stripe count a retry once. Stripe sums the values of a meter, so `value` is what is new.
  async reportMeterEvent({ eventName, customerId, value, identifier }: { eventName: string; customerId: string; value: number; identifier: string }): Promise<void> {
    await this.call('POST', '/billing/meter_events', { event_name: eventName, 'payload[stripe_customer_id]': customerId, 'payload[value]': String(value), identifier });
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, string>, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        ...(body && { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
      },
      body: body && new URLSearchParams(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    // Stripe's error messages never echo the secret key.
    if (!res.ok) throw new StripeApiError(res.status, data.error?.code, `Stripe answered ${res.status}: ${data.error?.message ?? 'no detail'}`);
    return data as T;
  }
}

const seconds = z.number().int().positive();
const toDate = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

// Since API version 2025-03-31 the billing period lives on the subscription's items rather than on the subscription.
const SubscriptionSchema = z.object({
  id: z.string().min(1),
  customer: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
  status: z.string().min(1),
  created: seconds,
  metadata: z.record(z.string(), z.string()).default({}),
  cancel_at: seconds.nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  current_period_end: seconds.optional(),
  items: z.object({
    data: z.array(z.object({ price: z.object({ id: z.string() }), current_period_end: seconds.optional() })),
  }),
});

const CheckoutSessionSchema = z.object({
  id: z.string(),
  // "complete" once paid; the subscription is only there from then on.
  status: z.string().nullable(),
  customer: z.union([z.string(), z.object({ id: z.string() })]).nullable(),
  client_reference_id: z.string().nullable(),
  subscription: z.unknown().nullable(),
});

export interface CheckoutSession {
  customerId: string | null;
  tenantId: string | null;
  // Null until the checkout is complete.
  subscription: Subscription | null;
}

export function parseCheckoutSession(raw: unknown): CheckoutSession {
  const s = CheckoutSessionSchema.parse(raw);
  return {
    customerId: s.customer === null ? null : typeof s.customer === 'string' ? s.customer : s.customer.id,
    tenantId: s.client_reference_id,
    subscription: s.status === 'complete' && s.subscription && typeof s.subscription === 'object' ? parseSubscription(s.subscription) : null,
  };
}

// Throws a ZodError for a payload that is not a subscription.
export function parseSubscription(raw: unknown): Subscription {
  const s = SubscriptionSchema.parse(raw);
  const item = s.items.data[0];
  const currentPeriodEnd = toDate(item?.current_period_end ?? s.current_period_end);
  return {
    id: s.id,
    customerId: typeof s.customer === 'string' ? s.customer : s.customer.id,
    // Not a tenant id (edited in the Stripe Dashboard): treated as missing, never sent to the database.
    tenantId: IdSchema.safeParse(s.metadata.tenantId).success ? s.metadata.tenantId : undefined,
    status: s.status,
    created: new Date(s.created * 1000),
    priceId: item?.price.id ?? null,
    currentPeriodEnd,
    // "Cancel at period end" sets cancel_at too on current API versions; older ones only set the flag.
    cancelAt: toDate(s.cancel_at) ?? (s.cancel_at_period_end ? currentPeriodEnd : null),
  };
}
