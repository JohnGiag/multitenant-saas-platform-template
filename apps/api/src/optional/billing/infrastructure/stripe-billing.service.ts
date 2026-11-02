import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingStatus, PaidTier } from '@repo/shared-types';
import type { Queue } from 'bullmq';
import { hasCode } from '../../../common/prisma-errors.js';
import { withTimeout } from '../../../common/with-timeout.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { recordEvent } from '../../../modules/events/infrastructure/outbox.js';
import { QUEUE_TIMEOUT_MS } from '../../../modules/jobs/job-config.js';
import { TenantDeletionHooks } from '../../../modules/tenancy/domain/tenant-deletion-hooks.js';
import { UsageMeter } from '../../../modules/usage/domain/usage-meter.js';
import {
  BillingConflictError,
  BillingNotConfiguredError,
  BillingNotFoundError,
  type BillingService,
} from '../domain/ports/billing.service.js';
import { decideEvent, hasEnded, tierOf, type Subscription } from '../domain/subscription.js';
import { billingConfig, type BillingConfig } from './billing-config.js';
import { parseCheckoutSession, StripeApi, StripeApiError } from './stripe-api.js';

export const BILLING_QUEUE = 'billing';

// Drops a cancelled tenant to free when its paid period ends. It carries the tenant, nothing else.
export interface PeriodEndJob {
  tenantId: string;
}

// Tells Stripe what is new in a usage record.
export interface UsageReportJob {
  tenantId: string;
  recordId: string;
}
export const USAGE_REPORT_JOB = 'usage-report';
export type BillingJob = PeriodEndJob | UsageReportJob;

// One job per tenant and cancellation time, so a webhook delivered twice schedules it once.
export const periodEndJobId = (tenantId: string, cancelAt: Date) => `period-end-${tenantId}-${cancelAt.getTime()}`;

// Already gone in Stripe is what was asked for. Anything else is rethrown, so the caller retries rather than leaves it charging.
function unlessGone(error: unknown): void {
  if (!(error instanceof StripeApiError && (error.status === 404 || error.code === 'resource_missing'))) throw error;
}

@Injectable()
export class StripeBillingService implements BillingService, OnModuleInit {
  private readonly logger = new Logger('Billing');
  private readonly billing: BillingConfig | null;
  private readonly stripe: StripeApi | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue<BillingJob>,
    deletionHooks: TenantDeletionHooks,
    private readonly usage: UsageMeter,
  ) {
    // Validated here, at boot: a half-configured billing stops startup.
    this.billing = billingConfig((name) => config.get<string>(name) || undefined);
    this.stripe = this.billing && new StripeApi(this.billing.secretKey);
    deletionHooks.register((tenantId) => this.forgetTenant(tenantId));
  }

  // Null while billing is off: the webhook then answers 404.
  get webhookSecret(): string | null {
    return this.billing?.webhookSecret ?? null;
  }

  async status(tenantId: string): Promise<BillingStatus> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { tier: true, billingAccount: { select: { status: true, currentPeriodEnd: true, cancelAt: true } } },
    });
    const account = tenant.billingAccount;
    return {
      tier: tenant.tier,
      status: account?.status ?? null,
      currentPeriodEnd: account?.currentPeriodEnd?.toISOString() ?? null,
      cancelAt: account?.cancelAt?.toISOString() ?? null,
    };
  }

  async checkout(tenantId: string, tier: PaidTier): Promise<string> {
    const { billing, stripe } = this.configured();
    const account = await this.prisma.billingAccount.findUnique({ where: { tenantId } });
    // A second subscription would be charged while the tier follows only the first.
    if (account?.status && !hasEnded(account.status)) {
      throw new BillingConflictError('This tenant already has a subscription: change or cancel it in the billing portal');
    }
    const customerId = account?.stripeCustomerId ?? (await this.createCustomer(tenantId, stripe));
    return stripe.createCheckoutSession({
      customerId,
      priceId: billing.prices[tier],
      tenantId,
      // Stripe fills in the session id, which the Billing page sends back to confirmCheckout.
      successUrl: this.dashboardUrl('billing?checkout_session={CHECKOUT_SESSION_ID}'),
      cancelUrl: this.dashboardUrl('billing'),
    });
  }

  async confirmCheckout(tenantId: string, sessionId: string): Promise<BillingStatus> {
    const { stripe } = this.configured();
    const account = await this.prisma.billingAccount.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } });
    if (!account) throw new BillingNotFoundError('No checkout for this tenant');
    let session;
    try {
      session = parseCheckoutSession(await stripe.retrieveCheckoutSession(sessionId));
    } catch (error) {
      if (error instanceof StripeApiError && error.status === 404) throw new BillingNotFoundError('No such checkout session');
      throw error;
    }
    // Another tenant's session answers like a missing one.
    if (session.customerId !== account.stripeCustomerId || session.tenantId !== tenantId) {
      throw new BillingNotFoundError('No such checkout session');
    }
    // Ordered by the subscription's creation time, which no webhook about it predates: a newer event already applied
    // wins, and the webhook arriving later applies the same state again.
    if (session.subscription) await this.applySubscription(session.subscription, session.subscription.created);
    return this.status(tenantId);
  }

  async portal(tenantId: string): Promise<string> {
    const { stripe } = this.configured();
    const account = await this.prisma.billingAccount.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } });
    if (!account) throw new BillingConflictError('This tenant has never subscribed: start with a plan');
    return stripe.createPortalSession(account.stripeCustomerId, this.dashboardUrl('billing'));
  }

  onModuleInit(): void {
    if (!this.stripe) return;
    this.usage.onFlushed(async ({ id, tenantId, quantity }) => {
      // One job per record and total: a flush repeated on another instance queues it once.
      await withTimeout(this.queue.add(USAGE_REPORT_JOB, { tenantId, recordId: id }, { jobId: `usage-${id}-${quantity}` }), QUEUE_TIMEOUT_MS, 'Queueing a job');
    });
  }

  // Runs from its job, with retries. The identifier holds the total, so a retry after Stripe answered and before this
  // row was updated is counted once. No customer means nothing to charge: a sandbox, or a tenant that never subscribed.
  async reportUsage(tenantId: string, recordId: string): Promise<void> {
    const { stripe } = this.configured();
    const [record, account] = await Promise.all([
      this.prisma.usageRecord.findFirst({ where: { id: recordId, tenantId } }),
      this.prisma.billingAccount.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } }),
    ]);
    if (!record || !account) return;
    const value = record.quantity - record.reportedQuantity;
    if (value <= 0) return;
    await stripe.reportMeterEvent({ eventName: record.meter, customerId: account.stripeCustomerId, value, identifier: `${record.id}-${record.quantity}` });
    await this.prisma.usageRecord.updateMany({ where: { id: recordId, tenantId, reportedQuantity: record.reportedQuantity }, data: { reportedQuantity: record.quantity } });
  }

  async applySubscription(subscription: Subscription, createdAt: Date): Promise<void> {
    const { tenantId } = subscription;
    if (!tenantId) {
      this.logger.warn(`Subscription ${subscription.id} ignored: it carries no tenantId (not created by our checkout)`);
      return;
    }
    const { billing, stripe } = this.configured();
    const { prices } = billing;
    let stray = false;
    const previous = await this.prisma.$transaction(async (tx) => {
      // Locked, so two deliveries for one tenant (Stripe sends several events per change) apply one after the other.
      await tx.$queryRaw`SELECT id FROM billing_accounts WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      // Both ids must match: metadata alone cannot move a subscription onto another tenant.
      const account = await tx.billingAccount.findFirst({ where: { tenantId, stripeCustomerId: subscription.customerId } });
      if (!account) {
        this.logger.warn(`Subscription ${subscription.id} ignored: customer ${subscription.customerId} is not tenant ${tenantId}'s`);
        return null;
      }
      const stored = { subscriptionId: account.stripeSubscriptionId, status: account.status, lastEventAt: account.lastEventAt };
      const decision = decideEvent(stored, subscription, createdAt);
      if (decision === 'other_subscription') {
        // Two Checkout pages both paid, or one made in the Stripe Dashboard. The tier follows only the stored one, so
        // a live second one would just charge the customer again. Late events of an ended one need nothing.
        stray = !hasEnded(subscription.status);
        if (stray) this.logger.error(`Tenant ${tenantId} paid for a second subscription ${subscription.id}: cancelled, refund it in Stripe`);
      }
      if (decision !== 'apply') return null;
      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          priceId: subscription.priceId,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAt: subscription.cancelAt,
          lastEventAt: createdAt,
        },
      });
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tier: true } });
      const after = await tx.tenant.update({ where: { id: tenantId }, data: { tier: tierOf(subscription, prices) }, select: { tier: true } });
      if (after.tier !== before.tier) await recordEvent(tx, tenantId, 'tenant.tier_changed', { tier: after.tier, previousTier: before.tier });
      return account;
    });
    // After the commit, and safe to repeat: a failure answers Stripe 500, and its retry lands here again.
    if (stray) await stripe.cancelSubscription(subscription.id).catch(unlessGone);
    if (!previous) return;
    await this.schedulePeriodEnd(tenantId, previous.cancelAt, subscription, prices);
  }

  // Runs at a scheduled cancellation's time. Stripe's own "deleted" event normally arrives then too, and whichever
  // comes first drops the tier; this one also covers a webhook that is late or lost.
  endPeriod(tenantId: string, now = new Date()): Promise<'downgraded' | 'skipped'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_accounts WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const account = await tx.billingAccount.findUnique({ where: { tenantId } });
      // Reactivated since (cancelAt cleared or moved later), already ended, or the tenant is gone.
      if (!account?.cancelAt || account.cancelAt > now || hasEnded(account.status)) return 'skipped';
      await tx.billingAccount.update({ where: { id: account.id }, data: { status: 'canceled' } });
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tier: true } });
      await tx.tenant.update({ where: { id: tenantId }, data: { tier: 'free' } });
      if (before.tier !== 'free') await recordEvent(tx, tenantId, 'tenant.tier_changed', { tier: 'free', previousTier: before.tier });
      return 'downgraded';
    });
  }

  private async schedulePeriodEnd(
    tenantId: string,
    previousCancelAt: Date | null,
    subscription: Subscription,
    prices: Record<PaidTier, string>,
  ): Promise<void> {
    const { cancelAt } = subscription;
    if (previousCancelAt && previousCancelAt.getTime() !== cancelAt?.getTime()) {
      // Reactivated or rescheduled. A job already running re-checks the account, so a failed removal is harmless.
      await withTimeout(this.queue.remove(periodEndJobId(tenantId, previousCancelAt)), QUEUE_TIMEOUT_MS, 'Removing a job').catch(() => undefined);
    }
    if (!cancelAt || tierOf(subscription, prices) === 'free') return;
    const delay = Math.max(0, cancelAt.getTime() - Date.now());
    await withTimeout(this.queue.add('period-end', { tenantId }, { jobId: periodEndJobId(tenantId, cancelAt), delay }), QUEUE_TIMEOUT_MS, 'Queueing a job');
  }

  // Tenant deleted: its customer goes, which also ends every subscription, a stray second one included. A failure
  // aborts the deletion for a retry. Its pending jobs go with the queue's own deletion hook (DeadLetteringWorker).
  private async forgetTenant(tenantId: string): Promise<void> {
    const account = await this.prisma.billingAccount.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } });
    if (!account) return;
    if (!this.stripe) {
      this.logger.warn(`Tenant ${tenantId} has Stripe customer ${account.stripeCustomerId} but STRIPE_* is unset: delete it in Stripe`);
      return;
    }
    await this.stripe.deleteCustomer(account.stripeCustomerId).catch(unlessGone);
  }

  private async createCustomer(tenantId: string, stripe: StripeApi): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    const customerId = await stripe.createCustomer(tenantId, tenant.name);
    try {
      await this.prisma.billingAccount.create({ data: { tenantId, stripeCustomerId: customerId } });
    } catch (error) {
      // A concurrent first checkout stored it first (the idempotency key gave both the same customer).
      if (!hasCode(error, 'P2002')) throw error;
    }
    return customerId;
  }

  private configured(): { billing: BillingConfig; stripe: StripeApi } {
    if (!this.billing || !this.stripe) throw new BillingNotConfiguredError('Billing is not configured: set STRIPE_*');
    return { billing: this.billing, stripe: this.stripe };
  }

  // Where Stripe sends the browser back: the dashboard's Billing page (APP_URL, which may include a path).
  private dashboardUrl(page: string): string {
    const base = this.config.get<string>('APP_URL');
    if (!base) throw new BillingNotConfiguredError('APP_URL is not set, so Stripe cannot send users back to the dashboard');
    return new URL(page, base.endsWith('/') ? base : `${base}/`).toString();
  }
}
