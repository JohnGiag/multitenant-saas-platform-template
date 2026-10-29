import { Module } from '@nestjs/common';
import { JobsModule } from '../../modules/jobs/jobs.module.js';
import { TenancyModule } from '../../modules/tenancy/tenancy.module.js';
import { BILLING_SERVICE } from './domain/ports/billing.service.js';
import { BillingWorker } from './infrastructure/billing.worker.js';
import { BILLING_QUEUE, StripeBillingService } from './infrastructure/stripe-billing.service.js';
import { BillingController } from './presentation/billing.controller.js';
import { StripeSignatureCheck } from './presentation/stripe-signature.check.js';
import { StripeWebhookController } from './presentation/stripe-webhook.controller.js';

@Module({
  imports: [TenancyModule, JobsModule.registerQueue(BILLING_QUEUE)],
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeBillingService, { provide: BILLING_SERVICE, useExisting: StripeBillingService }, BillingWorker, StripeSignatureCheck],
})
export class BillingModule {}
