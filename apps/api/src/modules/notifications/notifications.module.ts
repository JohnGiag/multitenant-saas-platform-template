import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { NotificationChannelRegistry } from './domain/notification-channel.js';
import { NOTIFICATION_SERVICE } from './domain/ports/notification.service.js';
import { NOTIFICATIONS_QUEUE, QueueingNotificationService } from './infrastructure/notification-service.js';
import { NotificationsWorker } from './infrastructure/notifications.worker.js';
import { SseHub } from './infrastructure/sse-hub.js';
import { NotificationsController } from './presentation/notifications.controller.js';

// Core: SSE, queueing and the worker. Durable channels (email, push) are optional modules that
// import this module and register themselves in NotificationChannelRegistry.
@Module({
  imports: [IntegrationsModule, TenancyModule, JobsModule.registerQueue(NOTIFICATIONS_QUEUE)],
  controllers: [NotificationsController],
  providers: [
    NotificationChannelRegistry,
    SseHub,
    NotificationsWorker,
    { provide: NOTIFICATION_SERVICE, useClass: QueueingNotificationService },
  ],
  exports: [NotificationChannelRegistry, NOTIFICATION_SERVICE],
})
export class NotificationsModule {}
