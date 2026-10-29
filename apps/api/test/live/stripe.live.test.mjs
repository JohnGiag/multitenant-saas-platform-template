// Opt-in, not part of `pnpm test`: checks the billing module's Stripe calls against a real Stripe account in TEST mode
// (sk_test_ keys only; a live key is refused). Creates a customer, a checkout and a portal session, an unpaid
// subscription (to check the parser against Stripe's real JSON), cancels it twice (to check what the tenant-deletion
// hook treats as "already gone"), then deletes the customer. Touches no database. Needs STRIPE_SECRET_KEY,
// STRIPE_PRICE_PRO, and the Customer Portal saved once in the Stripe Dashboard (Settings → Billing → Customer portal).
// Run: pnpm --filter @repo/api test:live (after a build).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, test } from 'node:test';
import { parseSubscription, StripeApi, StripeApiError } from '../../dist/optional/billing/infrastructure/stripe-api.js';

if (existsSync('.env')) process.loadEnvFile();
const { STRIPE_SECRET_KEY, STRIPE_PRICE_PRO } = process.env;
const skip = !STRIPE_SECRET_KEY?.startsWith('sk_test_') || !STRIPE_PRICE_PRO ? 'set STRIPE_SECRET_KEY (sk_test_…) and STRIPE_PRICE_PRO' : false;

const stripe = new StripeApi(STRIPE_SECRET_KEY ?? '');
const tenantId = crypto.randomUUID();
let customerId;

const raw = async (method, path, body) => {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: body && new URLSearchParams(body),
  });
  return { status: res.status, json: await res.json() };
};

after(async () => {
  if (customerId) await raw('DELETE', `/customers/${customerId}`);
});

test('Stripe creates the customer once per tenant, and the checkout and portal sessions', { skip }, async () => {
  customerId = await stripe.createCustomer(tenantId, 'Live check');
  assert.equal(await stripe.createCustomer(tenantId, 'Live check'), customerId, 'the idempotency key returns the same customer');

  const checkout = await stripe.createCheckoutSession({
    customerId,
    priceId: STRIPE_PRICE_PRO,
    tenantId,
    successUrl: 'https://app.example.test/billing?checkout=success',
    cancelUrl: 'https://app.example.test/billing',
  });
  assert.match(checkout, /^https:\/\/checkout\.stripe\.com\//);
  assert.match(await stripe.createPortalSession(customerId, 'https://app.example.test/billing'), /^https:\/\/billing\.stripe\.com\//);
});

test("a real subscription parses, and cancelling one that is already cancelled counts as gone", { skip }, async () => {
  assert.ok(customerId, 'the first step did not run');
  // Unpaid on purpose: no card needed, and Stripe still returns a full subscription object.
  const created = await raw('POST', '/subscriptions', {
    customer: customerId,
    'items[0][price]': STRIPE_PRICE_PRO,
    payment_behavior: 'default_incomplete',
    'metadata[tenantId]': tenantId,
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const subscription = parseSubscription(created.json);
  assert.equal(subscription.tenantId, tenantId);
  assert.equal(subscription.customerId, customerId);
  assert.equal(subscription.priceId, STRIPE_PRICE_PRO);
  assert.ok(subscription.currentPeriodEnd instanceof Date, 'the billing period was found');

  await stripe.cancelSubscription(subscription.id);
  // What the tenant-deletion hook sees when Stripe cancelled it already.
  const again = await stripe.cancelSubscription(subscription.id).then(
    () => 'ok',
    (error) => error,
  );
  if (again !== 'ok') {
    assert.ok(again instanceof StripeApiError);
    assert.ok(again.status === 404 || again.code === 'resource_missing', `the hook would not treat this as gone: ${again.status} ${again.code} ${again.message}`);
  }
});
