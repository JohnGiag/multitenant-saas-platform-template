import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { isEnabled, tierIsManaged } from '../dist/modules/system/domain/optional-module.js';
import { verifyStripeSignature } from '../dist/optional/billing/domain/stripe-signature.js';
import { decideEvent, tierOf } from '../dist/optional/billing/domain/subscription.js';
import { billingConfig } from '../dist/optional/billing/infrastructure/billing-config.js';
import { parseCheckoutSession, parseSubscription } from '../dist/optional/billing/infrastructure/stripe-api.js';

const SECRET = 'whsec_unit_test_secret';
const NOW = 1_800_000_000;
const sign = (body, t = NOW, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('Stripe signatures: the exact body, the right secret, a recent timestamp', () => {
  const body = '{"id":"evt_1"}';
  const verify = (header, raw = body) => verifyStripeSignature({ secret: SECRET, header, body: raw, nowSeconds: NOW });
  assert.equal(verify(sign(body)), true);
  assert.equal(verify(sign(body), Buffer.from(body)), true, 'raw bytes');
  assert.equal(verify(sign(body), '{"id":"evt_2"}'), false, 'tampered body');
  assert.equal(verify(sign(body, NOW, 'whsec_other')), false, 'another secret');
  assert.equal(verify(sign(body, NOW - 301)), false, 'too old');
  assert.equal(verify(sign(body, NOW + 301)), false, 'from the future');
  assert.equal(verify(`t=${NOW},v1=00`), false, 'short signature');
  assert.equal(verify(''), false);
  // While a secret is rolled, Stripe sends one v1 per secret.
  assert.equal(verify(`${sign(body, NOW, 'whsec_old')},v1=${sign(body).split('v1=')[1]}`), true);
});

const PRICES = { pro: 'price_pro', enterprise: 'price_ent' };

test('the tier follows the price while the subscription is paid for, including retries of a failed payment', () => {
  assert.equal(tierOf({ status: 'active', priceId: 'price_pro' }, PRICES), 'pro');
  assert.equal(tierOf({ status: 'trialing', priceId: 'price_ent' }, PRICES), 'enterprise');
  assert.equal(tierOf({ status: 'past_due', priceId: 'price_pro' }, PRICES), 'pro');
  for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled']) {
    assert.equal(tierOf({ status, priceId: 'price_pro' }, PRICES), 'free', status);
  }
  assert.equal(tierOf({ status: 'active', priceId: 'price_unknown' }, PRICES), 'free', 'a price we do not sell');
});

test('events apply in order, never revive an ended subscription, and a second subscription does not take over', () => {
  const t = (s) => new Date(NOW * 1000 + s * 1000);
  const event = (id, status = 'active') => ({ id, status });
  const stored = (subscriptionId, status, lastEventAt = t(0)) => ({ subscriptionId, status, lastEventAt });

  assert.equal(decideEvent({ subscriptionId: null, status: null, lastEventAt: null }, event('sub_1'), t(0)), 'apply');
  assert.equal(decideEvent(stored('sub_1', 'active'), event('sub_1'), t(1)), 'apply');
  assert.equal(decideEvent(stored('sub_1', 'active'), event('sub_1'), t(0)), 'apply', 'same second: applied again');
  assert.equal(decideEvent(stored('sub_1', 'active'), event('sub_1'), t(-1)), 'stale');
  assert.equal(decideEvent(stored('sub_1', 'canceled'), event('sub_1'), t(5)), 'stale', 'ended stays ended');
  assert.equal(decideEvent(stored('sub_1', 'canceled'), event('sub_2'), t(5)), 'apply', 'new checkout after the end');
  assert.equal(decideEvent(stored('sub_1', 'canceled'), event('sub_2', 'canceled'), t(5)), 'other_subscription');
  assert.equal(decideEvent(stored('sub_2', 'active'), event('sub_1', 'canceled'), t(5)), 'other_subscription', 'late event of the old one');
});

const subscription = (extra = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  created: NOW - 60,
  metadata: { tenantId: '01900000-0000-7000-8000-000000000001' },
  items: { data: [{ price: { id: 'price_pro' }, current_period_end: NOW }] },
  ...extra,
});

test('subscriptions parse from both the current and the older API shapes', () => {
  const current = parseSubscription(subscription({ cancel_at: NOW, cancel_at_period_end: true }));
  assert.deepEqual(current, {
    id: 'sub_1',
    customerId: 'cus_1',
    tenantId: '01900000-0000-7000-8000-000000000001',
    status: 'active',
    created: new Date((NOW - 60) * 1000),
    priceId: 'price_pro',
    currentPeriodEnd: new Date(NOW * 1000),
    cancelAt: new Date(NOW * 1000),
  });
  // Before 2025-03-31: the period on the subscription, and only the flag for "cancel at period end".
  const older = parseSubscription(
    subscription({ current_period_end: NOW, cancel_at_period_end: true, customer: { id: 'cus_1' }, items: { data: [{ price: { id: 'price_pro' } }] } }),
  );
  assert.equal(older.currentPeriodEnd.getTime(), NOW * 1000);
  assert.equal(older.cancelAt.getTime(), NOW * 1000);
  assert.equal(older.customerId, 'cus_1');
  assert.equal(parseSubscription(subscription({ cancel_at: null })).cancelAt, null);
  assert.equal(parseSubscription(subscription({ metadata: { tenantId: 'not-a-uuid' } })).tenantId, undefined);
  assert.equal(parseSubscription(subscription({ metadata: undefined })).tenantId, undefined);
  assert.throws(() => parseSubscription({ id: 'sub_1' }));
});

test('a checkout session carries its subscription only once complete', () => {
  const session = (extra) => ({ id: 'cs_1', status: 'complete', customer: 'cus_1', client_reference_id: 'tenant-1', subscription: subscription(), ...extra });
  const complete = parseCheckoutSession(session());
  assert.deepEqual(
    { customerId: complete.customerId, tenantId: complete.tenantId, id: complete.subscription.id },
    { customerId: 'cus_1', tenantId: 'tenant-1', id: 'sub_1' },
  );
  assert.equal(parseCheckoutSession(session({ status: 'open' })).subscription, null, 'not paid yet');
  assert.equal(parseCheckoutSession(session({ subscription: 'sub_1' })).subscription, null, 'not expanded');
  assert.equal(parseCheckoutSession(session({ customer: { id: 'cus_2' } })).customerId, 'cus_2');
});

test('billing config: all of STRIPE_* or none', () => {
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_PRO: 'price_a',
    STRIPE_PRICE_ENTERPRISE: 'price_b',
  };
  const from = (values) => (name) => values[name];
  assert.equal(billingConfig(from({})), null);
  assert.deepEqual(billingConfig(from(env)), { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices: { pro: 'price_a', enterprise: 'price_b' } });
  assert.throws(() => billingConfig(from({ STRIPE_SECRET_KEY: 'sk_test_x' })), /STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_ENTERPRISE/);
  assert.throws(() => billingConfig(from({ ...env, STRIPE_SECRET_KEY: 'pk_test_x' })), /STRIPE_SECRET_KEY/, 'a publishable key');
  assert.throws(() => billingConfig(from({ ...env, STRIPE_PRICE_ENTERPRISE: 'price_a' })), /must differ/);
  // Never the values in the error: they include the secret key.
  assert.throws(() => billingConfig(from({ ...env, STRIPE_WEBHOOK_SECRET: 'sk_live_leak' })), (e) => !e.message.includes('sk_live_leak'));
});

test('a module that needs platform settings is disabled without them, and only then owns tenant tiers', () => {
  const billing = { key: 'billing', platformReady: (s) => s('KEY') !== undefined, ownsTenantTier: true, module: class {} };
  const plain = { key: 'webhooks', module: class {} };
  const none = () => undefined;
  const some = (name) => (name === 'KEY' ? 'x' : undefined);
  assert.equal(isEnabled(billing, new Set(), none), false);
  assert.equal(isEnabled(billing, new Set(), some), true);
  assert.equal(isEnabled(plain, new Set(), none), true);
  assert.equal(tierIsManaged([plain, billing], none), false);
  assert.equal(tierIsManaged([plain, billing], some), true);
  assert.equal(tierIsManaged([plain], some), false);
});
