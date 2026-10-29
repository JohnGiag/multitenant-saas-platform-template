// Billing with Stripe stubbed: API calls are recorded and answered here, webhooks are signed with a test secret.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { BillingRedirectSchema, BillingStatusSchema } from '@repo/shared-types';
import { PUBLIC_LIMIT } from '../dist/modules/rate-limit/domain/rate-limit-policy.js';
import { cleanup, db, randomIp, seedTenant, startApp, testQueue, waitFor } from './helpers.mjs';

const STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_billing_e2e',
  STRIPE_WEBHOOK_SECRET: `whsec_e2e_${crypto.randomUUID()}`,
  STRIPE_PRICE_PRO: 'price_pro_e2e',
  STRIPE_PRICE_ENTERPRISE: 'price_ent_e2e',
};
Object.assign(process.env, STRIPE);

// Stripe's API: every call recorded. Customers are keyed by the idempotency key, like Stripe does for 24 hours.
const stripeCalls = [];
// Checkout sessions by id, as GET /v1/checkout/sessions/:id answers them (the test decides their state).
const checkoutSessions = new Map();
let cancelResponse = () => new Response('{}', { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.stripe.com') return realFetch(input, init);
  const call = {
    method: init.method,
    path: url.pathname,
    search: url.search,
    body: Object.fromEntries(new URLSearchParams(init.body ?? '')),
    idempotencyKey: init.headers['idempotency-key'],
    authorization: init.headers.authorization,
  };
  stripeCalls.push(call);
  if (call.path === '/v1/customers') return Response.json({ id: `cus_${call.idempotencyKey.slice(-12)}` });
  if (call.path === '/v1/checkout/sessions') return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_e2e' });
  if (call.path === '/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/p/session/test_e2e' });
  if (call.method === 'DELETE' && call.path.startsWith('/v1/subscriptions/')) return cancelResponse();
  if (call.method === 'GET' && call.path.startsWith('/v1/checkout/sessions/')) {
    const session = checkoutSessions.get(call.path.split('/').at(-1));
    return session
      ? Response.json(session)
      : Response.json({ error: { code: 'resource_missing', message: 'No such checkout.session' } }, { status: 404 });
  }
  return Response.json({ error: { message: 'not stubbed' } }, { status: 500 });
};

const tenants = {};
const tokens = {};
let app, call, login;

before(async () => {
  tenants.platform = await seedTenant('billing-e2e-platform', { super: 'SuperAdmin' });
  tenants.a = await seedTenant('billing-e2e-a', { admin: 'TenantAdmin', user: 'User', auditor: 'Auditor' });
  tenants.b = await seedTenant('billing-e2e-b', { admin: 'TenantAdmin' });
  ({ app, call, login } = await startApp());
  tokens.super = await login(tenants.platform, 'super@example.com');
  tokens.adminA = await login(tenants.a, 'admin@example.com');
  tokens.userA = await login(tenants.a, 'user@example.com');
  tokens.auditorA = await login(tenants.a, 'auditor@example.com');
  tokens.adminB = await login(tenants.b, 'admin@example.com');
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const name of ['billing', 'billing-dlq']) {
    const queue = testQueue(name);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  await cleanup(app, Object.values(tenants));
});

const now = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

// A Stripe subscription object as webhooks carry it (current API shape).
const subscription = (tenantId, customer, { id = 'sub_a', status = 'active', price = STRIPE.STRIPE_PRICE_PRO, periodEnd = now() + 30 * DAY, cancelAt = null } = {}) => ({
  id,
  object: 'subscription',
  customer,
  status,
  created: now() - 60,
  metadata: { tenantId },
  cancel_at: cancelAt,
  cancel_at_period_end: cancelAt !== null,
  items: { data: [{ price: { id: price }, current_period_end: periodEnd }] },
});

// Signed like Stripe signs: HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret.
function webhook(type, object, { created = now(), secret = STRIPE.STRIPE_WEBHOOK_SECRET, t = now(), signature, ip } = {}) {
  const body = { id: `evt_${crypto.randomUUID()}`, type, created, data: { object } };
  const v1 = createHmac('sha256', secret).update(`${t}.${JSON.stringify(body)}`).digest('hex');
  return call('POST', '/billing/webhook', { body, ip, headers: { 'stripe-signature': signature ?? `t=${t},v1=${v1}` } });
}

const status = async (token = tokens.adminA) => {
  const res = await call('GET', '/billing', { token });
  assert.equal(res.status, 200);
  return BillingStatusSchema.parse(await res.json());
};
const tierOf = async (tenantId) => (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).tier;
const customerOf = async (tenantId) => (await db.billingAccount.findUniqueOrThrow({ where: { tenantId } })).stripeCustomerId;

test('admins and auditors read the status; users and SuperAdmin get nothing', async () => {
  assert.deepEqual(await status(), { tier: 'free', status: null, currentPeriodEnd: null, cancelAt: null });
  assert.equal((await status(tokens.auditorA)).tier, 'free');
  assert.equal((await call('GET', '/billing', { token: tokens.userA })).status, 403);
  assert.equal((await call('GET', '/billing', { token: tokens.super, tenant: tenants.a })).status, 403);
  const caps = (await (await call('GET', '/system/capabilities', { token: tokens.adminA })).json()).capabilities;
  assert.deepEqual(caps.find((c) => c.key === 'billing'), { key: 'billing', integration: null, enabled: true });
});

test('checkout creates the Stripe customer once, tags the subscription with the tenant, and only admins may start it', async () => {
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.userA, body: { tier: 'pro' } })).status, 403);
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.auditorA, body: { tier: 'pro' } })).status, 403);
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.adminA, body: { tier: 'free' } })).status, 400);

  stripeCalls.length = 0;
  const res = await call('POST', '/billing/checkout', { token: tokens.adminA, body: { tier: 'pro' } });
  assert.equal(res.status, 201);
  assert.equal(BillingRedirectSchema.parse(await res.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_e2e');

  const [customer, session] = stripeCalls;
  assert.deepEqual(customer.body, { name: 'billing-e2e-a', 'metadata[tenantId]': tenants.a });
  assert.equal(customer.idempotencyKey, `customer-${tenants.a}`);
  assert.equal(customer.authorization, `Bearer ${STRIPE.STRIPE_SECRET_KEY}`);
  assert.equal(session.body.mode, 'subscription');
  assert.equal(session.body.customer, await customerOf(tenants.a));
  assert.equal(session.body['line_items[0][price]'], STRIPE.STRIPE_PRICE_PRO);
  assert.equal(session.body['subscription_data[metadata][tenantId]'], tenants.a);
  // Stripe fills in {CHECKOUT_SESSION_ID}; the Billing page sends it back to /billing/checkout/confirm.
  assert.equal(session.body.success_url, 'https://app.example.test/billing?checkout_session={CHECKOUT_SESSION_ID}');

  // Abandoned and started again: the same customer.
  stripeCalls.length = 0;
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.adminA, body: { tier: 'enterprise' } })).status, 201);
  assert.deepEqual(stripeCalls.map((c) => c.path), ['/v1/checkout/sessions']);
  assert.equal(stripeCalls[0].body['line_items[0][price]'], STRIPE.STRIPE_PRICE_ENTERPRISE);
});

test('webhooks need a valid, recent Stripe signature', async () => {
  const object = subscription(tenants.a, await customerOf(tenants.a));
  assert.equal((await webhook('customer.subscription.created', object, { secret: 'whsec_wrong' })).status, 400);
  assert.equal((await webhook('customer.subscription.created', object, { t: now() - 600 })).status, 400);
  assert.equal((await webhook('customer.subscription.created', object, { signature: '' })).status, 400);
  assert.equal(await tierOf(tenants.a), 'free');
  // Other event types are acknowledged and ignored.
  assert.equal((await webhook('invoice.paid', { id: 'in_1' })).status, 204);
  assert.equal((await webhook('customer.subscription.updated', { id: 'sub_x' })).status, 400, 'malformed subscription');
});

test("signed webhooks are not rate limited, so Stripe's bursts get through; unsigned ones still are", async () => {
  const ip = randomIp();
  for (let i = 0; i < PUBLIC_LIMIT + 5; i++) {
    const res = await webhook('invoice.paid', { id: `in_${i}` }, { ip });
    assert.equal(res.status, 204, `signed event ${i + 1}`);
    assert.equal(res.headers.get('x-ratelimit-limit'), null);
  }
  const forger = randomIp();
  for (let i = 0; i < PUBLIC_LIMIT; i++) assert.equal((await webhook('invoice.paid', {}, { ip: forger, secret: 'whsec_forged' })).status, 400);
  assert.equal((await webhook('invoice.paid', {}, { ip: forger, secret: 'whsec_forged' })).status, 429);
  // A valid signature from that address still gets through: the signature, not the IP, is what is trusted.
  assert.equal((await webhook('invoice.paid', {}, { ip: forger })).status, 204);
});

test('back from checkout, the paid plan applies at once, before any webhook', async () => {
  tenants.c = await seedTenant('billing-e2e-c', { admin: 'TenantAdmin', auditor: 'Auditor' });
  const admin = await login(tenants.c, 'admin@example.com');
  const auditor = await login(tenants.c, 'auditor@example.com');
  assert.equal((await call('POST', '/billing/checkout', { token: admin, body: { tier: 'enterprise' } })).status, 201);
  const customer = await customerOf(tenants.c);
  const sub = subscription(tenants.c, customer, { id: 'sub_c', price: STRIPE.STRIPE_PRICE_ENTERPRISE });
  checkoutSessions.set('cs_test_open', { id: 'cs_test_open', status: 'open', customer, client_reference_id: tenants.c, subscription: null });
  checkoutSessions.set('cs_test_c', { id: 'cs_test_c', status: 'complete', customer, client_reference_id: tenants.c, subscription: sub });
  const confirm = (sessionId, token = admin) => call('POST', '/billing/checkout/confirm', { token, body: { sessionId } });

  // Left the checkout before paying: nothing changes.
  const open = await confirm('cs_test_open');
  assert.equal(open.status, 200);
  assert.equal(BillingStatusSchema.parse(await open.json()).tier, 'free');

  stripeCalls.length = 0;
  const paid = await confirm('cs_test_c');
  assert.equal(paid.status, 200);
  const body = BillingStatusSchema.parse(await paid.json());
  assert.deepEqual({ tier: body.tier, status: body.status }, { tier: 'enterprise', status: 'active' });
  assert.equal(await tierOf(tenants.c), 'enterprise');
  assert.deepEqual(
    stripeCalls.map((c) => `${c.method} ${c.path}${decodeURIComponent(c.search)}`),
    ['GET /v1/checkout/sessions/cs_test_c?expand[]=subscription'],
  );

  // The reload and the webhook arriving afterwards apply the same state again.
  assert.equal((await confirm('cs_test_c')).status, 200);
  assert.equal((await webhook('customer.subscription.created', sub, { created: sub.created })).status, 204);
  assert.equal(await tierOf(tenants.c), 'enterprise');

  assert.equal((await confirm('cs_test_c', tokens.adminA)).status, 404, 'a session of another tenant');
  assert.equal((await confirm('cs_test_unknown')).status, 404);
  assert.equal((await confirm('not-a-session')).status, 400);
  assert.equal((await confirm('cs_test_c', auditor)).status, 403);
});

test('a subscription sets the tier; a late, older event changes nothing; a failed payment keeps it while Stripe retries', async () => {
  const customer = await customerOf(tenants.a);
  const created = now();
  assert.equal((await webhook('customer.subscription.created', subscription(tenants.a, customer), { created })).status, 204);
  assert.equal(await tierOf(tenants.a), 'pro');
  const s = await status();
  assert.equal(s.status, 'active');
  assert.ok(s.currentPeriodEnd);
  assert.equal(await tierOf(tenants.b), 'free', 'other tenants are untouched');

  // Delivered late: created before the one already applied.
  await webhook('customer.subscription.updated', subscription(tenants.a, customer, { status: 'incomplete' }), { created: created - 60 });
  assert.equal(await tierOf(tenants.a), 'pro');

  await webhook('customer.subscription.updated', subscription(tenants.a, customer, { status: 'past_due' }), { created: created + 1 });
  assert.equal(await tierOf(tenants.a), 'pro');
  await webhook('customer.subscription.updated', subscription(tenants.a, customer, { price: STRIPE.STRIPE_PRICE_ENTERPRISE }), { created: created + 2 });
  assert.equal(await tierOf(tenants.a), 'enterprise');
});

test('a second checkout is refused while subscribed; the portal opens for the customer', async () => {
  const res = await call('POST', '/billing/checkout', { token: tokens.adminA, body: { tier: 'pro' } });
  assert.equal(res.status, 409);
  stripeCalls.length = 0;
  const portal = await call('POST', '/billing/portal', { token: tokens.adminA });
  assert.equal(portal.status, 201);
  assert.equal(BillingRedirectSchema.parse(await portal.json()).url, 'https://billing.stripe.com/p/session/test_e2e');
  assert.deepEqual(stripeCalls[0].body, { customer: await customerOf(tenants.a), return_url: 'https://app.example.test/billing' });
  // Tenant B never subscribed.
  assert.equal((await call('POST', '/billing/portal', { token: tokens.adminB })).status, 409);
});

test("a subscription cannot be moved onto another tenant: tenant and customer must both match", async () => {
  const customerA = await customerOf(tenants.a);
  await webhook('customer.subscription.created', subscription(tenants.b, customerA, { id: 'sub_spoof', price: STRIPE.STRIPE_PRICE_ENTERPRISE }));
  assert.equal(await tierOf(tenants.b), 'free');
  await webhook('customer.subscription.created', subscription(tenants.a, 'cus_unknown', { id: 'sub_unknown', status: 'canceled' }));
  assert.equal(await tierOf(tenants.a), 'enterprise');
});

test('the SuperAdmin cannot set tiers while billing is on, but still renames tenants', async () => {
  assert.equal((await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.super, body: { tier: 'pro' } })).status, 409);
  const renamed = await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.super, body: { name: 'billing-e2e-b' } });
  assert.equal(renamed.status, 200);
  // A form that sends the current tier back along with the name is not a tier change.
  const both = await call('PATCH', `/tenants/${tenants.b}`, { token: tokens.super, body: { name: 'billing-e2e-b', tier: 'free' } });
  assert.equal(both.status, 200);
});

test('a cancellation keeps the paid tier until the period ends, then the job drops it to free', async () => {
  // Tenant B subscribes through checkout, then cancels at the end of a period that ends in a moment.
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.adminB, body: { tier: 'pro' } })).status, 201);
  const customer = await customerOf(tenants.b);
  const created = now();
  await webhook('customer.subscription.created', subscription(tenants.b, customer, { id: 'sub_b' }), { created });
  assert.equal(await tierOf(tenants.b), 'pro');

  const endsAt = now() + 2;
  await webhook('customer.subscription.updated', subscription(tenants.b, customer, { id: 'sub_b', periodEnd: endsAt, cancelAt: endsAt }), {
    created: created + 1,
  });
  assert.equal(await tierOf(tenants.b), 'pro', 'the paid month stays paid');
  assert.equal((await status(tokens.adminB)).cancelAt, new Date(endsAt * 1000).toISOString());

  // No "deleted" webhook here (as if it were lost): the job alone ends it.
  await waitFor(async () => (await tierOf(tenants.b)) === 'free', 8000);
  assert.equal((await status(tokens.adminB)).status, 'canceled');
  // Stripe's own "deleted" event, arriving afterwards, changes nothing.
  await webhook('customer.subscription.deleted', subscription(tenants.b, customer, { id: 'sub_b', status: 'canceled' }), { created: created + 5 });
  assert.equal(await tierOf(tenants.b), 'free');

  // A new checkout after the end starts a new subscription.
  assert.equal((await call('POST', '/billing/checkout', { token: tokens.adminB, body: { tier: 'pro' } })).status, 201);
  await webhook('customer.subscription.created', subscription(tenants.b, customer, { id: 'sub_b2' }), { created: created + 6 });
  assert.equal(await tierOf(tenants.b), 'pro');
});

test('undoing a cancellation removes the pending job and keeps the tier', async () => {
  const customer = await customerOf(tenants.b);
  const created = now() + 10;
  const endsAt = now() + 30 * DAY;
  await webhook('customer.subscription.updated', subscription(tenants.b, customer, { id: 'sub_b2', periodEnd: endsAt, cancelAt: endsAt }), { created });
  const queue = testQueue('billing');
  const jobId = `period-end-${tenants.b}-${endsAt * 1000}`;
  assert.ok(await queue.getJob(jobId), 'the downgrade is scheduled');

  await webhook('customer.subscription.updated', subscription(tenants.b, customer, { id: 'sub_b2', periodEnd: endsAt }), { created: created + 1 });
  assert.equal(await queue.getJob(jobId), undefined, 'and unscheduled');
  assert.equal(await tierOf(tenants.b), 'pro');
  assert.equal((await status(tokens.adminB)).cancelAt, null);
  await queue.close();
});

test('an immediate cancellation (deleted event) drops the tier at once, and nothing revives it', async () => {
  const customer = await customerOf(tenants.b);
  const created = now() + 20;
  await webhook('customer.subscription.deleted', subscription(tenants.b, customer, { id: 'sub_b2', status: 'canceled' }), { created });
  assert.equal(await tierOf(tenants.b), 'free');
  await webhook('customer.subscription.updated', subscription(tenants.b, customer, { id: 'sub_b2' }), { created: created + 1 });
  assert.equal(await tierOf(tenants.b), 'free', 'an ended subscription stays ended');
});

test('deleting a tenant cancels its subscription in Stripe first; a failure keeps the tenant for a retry', async () => {
  tenants.doomed = await seedTenant('billing-e2e-doomed', { admin: 'TenantAdmin' });
  const admin = await login(tenants.doomed, 'admin@example.com');
  await call('POST', '/billing/checkout', { token: admin, body: { tier: 'pro' } });
  await webhook('customer.subscription.created', subscription(tenants.doomed, await customerOf(tenants.doomed), { id: 'sub_doomed' }));
  assert.equal(await tierOf(tenants.doomed), 'pro');

  cancelResponse = () => Response.json({ error: { message: 'down' } }, { status: 500 });
  assert.equal((await call('DELETE', `/tenants/${tenants.doomed}`, { token: tokens.super })).status, 500);
  assert.equal(await db.tenant.count({ where: { id: tenants.doomed } }), 1, 'kept, still charged: retry later');

  cancelResponse = () => Response.json({ error: { code: 'resource_missing', message: 'No such subscription' } }, { status: 404 });
  stripeCalls.length = 0;
  assert.equal((await call('DELETE', `/tenants/${tenants.doomed}`, { token: tokens.super })).status, 204);
  assert.deepEqual(stripeCalls.map((c) => `${c.method} ${c.path}`), ['DELETE /v1/subscriptions/sub_doomed']);
  assert.equal(await db.billingAccount.count({ where: { tenantId: tenants.doomed } }), 0, 'its billing row goes by cascade');
  cancelResponse = () => new Response('{}', { status: 200 });
});

test('without STRIPE_* the module is installed but off: no webhook, no checkout, and tiers are set by hand', async () => {
  const saved = { ...STRIPE };
  // Empty rather than deleted, so ConfigModule does not read them back from .env.
  for (const name of Object.keys(STRIPE)) process.env[name] = '';
  const off = await startApp();
  try {
    const superToken = await off.login(tenants.platform, 'super@example.com');
    const admin = await off.login(tenants.a, 'admin@example.com');
    assert.equal((await off.call('POST', '/billing/webhook', { body: {} })).status, 404);
    assert.equal((await off.call('POST', '/billing/checkout', { token: admin, body: { tier: 'pro' } })).status, 503);
    const caps = (await (await off.call('GET', '/system/capabilities', { token: admin })).json()).capabilities;
    assert.equal(caps.find((c) => c.key === 'billing').enabled, false);
    assert.equal((await off.call('PATCH', `/tenants/${tenants.b}`, { token: superToken, body: { tier: 'pro' } })).status, 200);
  } finally {
    await off.app.close();
    Object.assign(process.env, saved);
  }
});
