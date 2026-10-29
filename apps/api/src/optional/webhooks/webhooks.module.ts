import { Module } from '@nestjs/common';
import { JobsModule } from '../../modules/jobs/jobs.module.js';
import { TenancyModule } from '../../modules/tenancy/tenancy.module.js';
import { WEBHOOK_SERVICE } from './domain/ports/webhook.service.js';
import { PrismaWebhookService, WEBHOOKS_QUEUE } from './infrastructure/prisma-webhook.service.js';
import { WebhooksWorker } from './infrastructure/webhooks.worker.js';
import { WebhooksController } from './presentation/webhooks.controller.js';

@Module({
  imports: [TenancyModule, JobsModule.registerQueue(WEBHOOKS_QUEUE)],
  controllers: [WebhooksController],
  providers: [PrismaWebhookService, { provide: WEBHOOK_SERVICE, useExisting: PrismaWebhookService }, WebhooksWorker],
})
export class WebhooksModule {}
