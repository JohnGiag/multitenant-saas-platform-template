import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebhookDeliveryError } from '@repo/shared-types';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import { openSecret, parseMasterKey } from '../../../modules/integrations/domain/secret-box.js';
import { DeadLetteringWorker, type DeadLetterRecord } from '../../../modules/jobs/dead-lettering.worker.js';
import { deadLetterQueueName } from '../../../modules/jobs/jobs.module.js';
import { TenantDeletionHooks } from '../../../modules/tenancy/domain/tenant-deletion-hooks.js';
import { isRetryableStatus, retryDelay } from '../domain/delivery-policy.js';
import { signWebhook } from '../domain/standard-webhooks.js';
import { BlockedAddressError, deliveryError, postWebhook } from './https-delivery.js';
import { secretContext, WEBHOOKS_QUEUE, type WebhookDeliveryJob } from './prisma-webhook.service.js';
import { allowPrivateTargets } from './webhooks-config.js';

type Result = 'delivered' | 'skipped';
interface Attempt {
  job: WebhookDeliveryJob;
  number: number;
  maxAttempts: number;
  startedAt: number;
}

// The schedule of jobs queued with backoff type "webhook" (delivery-policy.ts).
@Processor(WEBHOOKS_QUEUE, { settings: { backoffStrategy: (attemptsMade: number) => retryDelay(attemptsMade) } })
export class WebhooksWorker extends DeadLetteringWorker<WebhookDeliveryJob> {
  private readonly masterKey: Uint8Array;
  private readonly allowPrivate: boolean;

  constructor(
    @InjectQueue(WEBHOOKS_QUEUE) queue: Queue<WebhookDeliveryJob>,
    @InjectQueue(deadLetterQueueName(WEBHOOKS_QUEUE)) dlq: Queue<DeadLetterRecord<WebhookDeliveryJob>>,
    config: ConfigService,
    @Inject(REDIS_CLIENT) redis: Redis,
    deletionHooks: TenantDeletionHooks,
    private readonly prisma: PrismaService,
  ) {
    super(queue, dlq, config, redis, deletionHooks);
    this.masterKey = parseMasterKey(config.getOrThrow<string>('BYOK_MASTER_KEY'));
    this.allowPrivate = allowPrivateTargets(config);
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<Result> {
    const { tenantId, endpointId, payload } = job.data;
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId } });
    // Deleted or disabled since the event: not a failure.
    if (!endpoint?.enabled) return 'skipped';

    const secret = openSecret(this.masterKey, endpoint.encryptedSecret, secretContext(tenantId));
    const body = JSON.stringify(payload);
    // Signed at send time: receivers refuse old timestamps, and a retry may go out a day after the event.
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'enterprise-api-starter-webhooks',
      'webhook-id': payload.id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signWebhook({ secret, id: payload.id, timestamp, body }),
    };

    const startedAt = Date.now();
    const attempt = { job: job.data, number: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1, startedAt };
    let status: number;
    try {
      status = await postWebhook(new URL(endpoint.url), headers, body, this.allowPrivate);
    } catch (error) {
      // A refused address stays refused; a network error or a timeout may pass.
      const blocked = error instanceof BlockedAddressError;
      await this.record(attempt, { error: deliveryError(error), retries: !blocked });
      if (blocked) throw new UnrecoverableError(error.message);
      throw error;
    }
    const delivered = status >= 200 && status < 300;
    await this.record(attempt, { statusCode: status, retries: !delivered && isRetryableStatus(status) });
    if (delivered) return 'delivered';
    const message = `Endpoint ${endpoint.id} answered ${status}`;
    throw isRetryableStatus(status) ? new Error(message) : new UnrecoverableError(message);
  }

  // Never fails the delivery: losing a line of the log is better than sending the event again.
  private async record({ job, number, maxAttempts, startedAt }: Attempt, outcome: { statusCode?: number; error?: WebhookDeliveryError; retries: boolean }): Promise<void> {
    const { tenantId, endpointId, payload } = job;
    const willRetry = outcome.retries && number < maxAttempts;
    await this.prisma.webhookDelivery
      .create({
        data: {
          tenantId,
          endpointId,
          eventId: payload.id,
          eventType: payload.type,
          attempt: number,
          statusCode: outcome.statusCode,
          durationMs: Date.now() - startedAt,
          error: outcome.error,
          nextRetryAt: willRetry ? new Date(Date.now() + retryDelay(number)) : null,
          payload: payload as Prisma.InputJsonObject,
        },
      })
      .catch((err: unknown) => this.logger.error(`Delivery log failed for endpoint ${endpointId}: ${err instanceof Error ? err.message : String(err)}`));
  }
}
