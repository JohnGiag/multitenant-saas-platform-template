import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiDoc } from '../../../common/api-doc.js';
import { Public } from '../../../modules/auth/presentation/decorators.js';
import { ExemptTrustedCaller } from '../../../modules/rate-limit/presentation/trusted-caller.js';
import { BILLING_SERVICE, type BillingService } from '../domain/ports/billing.service.js';
import { parseSubscription } from '../infrastructure/stripe-api.js';
import { StripeSignatureCheck } from './stripe-signature.check.js';

// `created`: when Stripe created the event, the same on every retry, so it orders late deliveries.
const EventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  created: z.number().int().positive(),
  data: z.object({ object: z.unknown() }),
});

// Every event that changes a subscription's status, plan, period or scheduled cancellation.
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

interface WebhookRequest {
  // Kept by createApp ({ rawBody: true }): the signature covers the exact bytes Stripe sent.
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('billing')
export class StripeWebhookController {
  constructor(
    @Inject(BILLING_SERVICE) private readonly billing: BillingService,
    private readonly signature: StripeSignatureCheck,
  ) {}

  // Public: the signature is the credential. Exists only while billing is configured. Signed requests skip the rate
  // limit (Stripe's retries after an outage come in bursts); unsigned ones are limited per IP like any public route.
  @Public()
  @ExemptTrustedCaller(StripeSignatureCheck)
  @ApiDoc('Stripe webhook (billing only): keeps tenant tiers in step with their subscriptions. Signed by Stripe')
  @ApiHeader({ name: 'stripe-signature', required: true, description: 'HMAC-SHA256 of the raw body, keyed with STRIPE_WEBHOOK_SECRET' })
  @Post('webhook')
  @HttpCode(204)
  async receive(@Req() req: WebhookRequest, @Body() body: unknown): Promise<void> {
    if (!this.billing.webhookSecret) throw new NotFoundException();
    // 400, not 401: Stripe shows the status in its delivery log, and retries any non-2xx.
    if (!this.signature.isTrusted(req)) throw new BadRequestException('Invalid Stripe signature');

    const event = EventSchema.safeParse(body);
    if (!event.success) throw new BadRequestException('Not a Stripe event');
    // Every other event type (invoices, checkout sessions, …): nothing to mirror, answered 204 so Stripe stops sending it.
    if (!SUBSCRIPTION_EVENTS.has(event.data.type)) return;

    let subscription;
    try {
      subscription = parseSubscription(event.data.data.object);
    } catch {
      // A malformed payload will not improve on retry; a database error (thrown below) should be retried.
      throw new BadRequestException(`Unexpected ${event.data.type} payload`);
    }
    await this.billing.applySubscription(subscription, new Date(event.data.created * 1000));
  }
}
