import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../../integrations/domain/ports/integration.service.js';
import { DeadLetteringWorker, type DeadLetterRecord } from '../../jobs/dead-lettering.worker.js';
import { deadLetterQueueName } from '../../jobs/jobs.module.js';
import { TenantDeletionHooks } from '../../tenancy/domain/tenant-deletion-hooks.js';
import {
  NotificationChannelRegistry,
  PermanentDeliveryError,
  type NotificationJob,
  type NotificationJobResult,
} from '../domain/notification-channel.js';
import { NOTIFICATIONS_QUEUE } from './notification-service.js';

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsWorker extends DeadLetteringWorker<NotificationJob> {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) queue: Queue<NotificationJob>,
    @InjectQueue(deadLetterQueueName(NOTIFICATIONS_QUEUE)) dlq: Queue<DeadLetterRecord<NotificationJob>>,
    config: ConfigService,
    @Inject(REDIS_CLIENT) redis: Redis,
    deletionHooks: TenantDeletionHooks,
    private readonly registry: NotificationChannelRegistry,
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
  ) {
    super(queue, dlq, config, redis, deletionHooks);
  }

  async process(job: Job<NotificationJob>): Promise<NotificationJobResult> {
    const { tenantId, channel: key, notification } = job.data;

    // Graceful degradation: a module removed or a config deleted after queueing is a skip, not a failure.
    const channel = this.registry.get(key);
    if (!channel) return this.skip(job, `channel "${key}" is not installed`);
    // Secrets are loaded here, per job and per tenant, never carried in the payload.
    const secrets = await this.integrations.getSecrets(tenantId, channel.integration);
    if (!secrets) return this.skip(job, `"${channel.integration}" is not configured or disabled`);

    try {
      // id + enqueue time: unique even if job ids restart after the queue is emptied.
      await channel.deliver({ tenantId, notification, secrets, deliveryId: `${job.id}-${job.timestamp}` });
    } catch (err) {
      // Retrying cannot fix it: skip the remaining attempts and go straight to the DLQ.
      if (err instanceof PermanentDeliveryError) throw new UnrecoverableError(err.message);
      throw err;
    }
    return { status: 'delivered' };
  }

  private skip(job: Job<NotificationJob>, reason: string): NotificationJobResult {
    this.logger.debug(`Job ${job.id} skipped for tenant ${job.data.tenantId}: ${reason}`);
    return { status: 'skipped', reason };
  }
}
