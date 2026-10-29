import { Inject, Injectable } from '@nestjs/common';
import type { TrustedCallerCheck } from '../../../modules/rate-limit/presentation/trusted-caller.js';
import { BILLING_SERVICE, type BillingService } from '../domain/ports/billing.service.js';
import { verifyStripeSignature } from '../domain/stripe-signature.js';

// A request Stripe signed with the webhook secret: the webhook's credential, and its rate-limit exemption.
@Injectable()
export class StripeSignatureCheck implements TrustedCallerCheck {
  constructor(@Inject(BILLING_SERVICE) private readonly billing: BillingService) {}

  isTrusted(req: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer }): boolean {
    const secret = this.billing.webhookSecret;
    const header = req.headers['stripe-signature'];
    return !!secret && req.rawBody !== undefined && typeof header === 'string' && verifyStripeSignature({ secret, header, body: req.rawBody });
  }
}
