import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Notification, SendNotificationResult } from '@repo/shared-types';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../../integrations/domain/ports/integration.service.js';
import { NotificationChannelRegistry, type NotificationJob } from '../domain/notification-channel.js';
import type { NotificationService } from '../domain/ports/notification.service.js';
import { SseHub } from './sse-hub.js';

export const NOTIFICATIONS_QUEUE = 'notifications';

@Injectable()
export class QueueingNotificationService implements NotificationService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationChannelRegistry,
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
    private readonly sse: SseHub,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJob>,
  ) {}

  async send(tenantId: string, notification: Notification): Promise<SendNotificationResult | null> {
    const recipient = await this.prisma.user.count({ where: { id: notification.userId, tenantId } });
    if (!recipient) return null;

    // Durable channels: only those installed (registered) and configured for this tenant. The worker
    // checks again at delivery time, since a module or a tenant's config can change in between.
    const channels = this.registry.all();
    const enabled = await this.integrations.enabledProviders(
      tenantId,
      channels.map((c) => c.integration),
    );
    const queued = channels.filter((c) => enabled.has(c.integration)).map((c) => c.key);
    for (const c of channels.filter((c) => !enabled.has(c.integration))) {
      this.logger.debug(`Skipping channel "${c.key}" for tenant ${tenantId}: "${c.integration}" not configured`);
    }
    await this.queue.addBulk(queued.map((channel) => ({ name: channel, data: { tenantId, channel, notification } })));

    // Real-time: best effort and not retried, since a user who is not connected misses it anyway.
    const realtime = await this.sse.publish(tenantId, notification).then(
      () => true,
      (err: unknown) => {
        this.logger.warn(`SSE publish failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      },
    );
    return { queued, realtime };
  }

  stream(tenantId: string, userId: string) {
    return this.sse.stream(tenantId, userId);
  }
}
