import { Module } from '@nestjs/common';
import { JobsModule } from '../../modules/jobs/jobs.module.js';
import { TenancyModule } from '../../modules/tenancy/tenancy.module.js';
import { WEBHOOK_SERVICE } from './domain/ports/webhook.service.js';
import { PrismaWebhookService, WEBHOOKS_PARTITIONS, WEBHOOKS_QUEUE, WebhookDeliverySweep } from './infrastructure/prisma-webhook.service.js';
import { WEBHOOKS_WORKERS } from './infrastructure/webhooks.worker.js';
import { WebhookDeliveriesController, WebhooksController } from './presentation/webhooks.controller.js';

@Module({
  imports: [TenancyModule, JobsModule.registerQueue(WEBHOOKS_QUEUE, { partitions: WEBHOOKS_PARTITIONS })],
  controllers: [WebhooksController, WebhookDeliveriesController],
  providers: [PrismaWebhookService, { provide: WEBHOOK_SERVICE, useExisting: PrismaWebhookService }, ...WEBHOOKS_WORKERS, WebhookDeliverySweep],
})
export class WebhooksModule {}
