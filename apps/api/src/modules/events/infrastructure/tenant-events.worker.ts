import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import { DeadLetteringWorker, type DeadLetterRecord } from '../../jobs/dead-lettering.worker.js';
import { deadLetterQueueName } from '../../jobs/jobs.module.js';
import { TenantDeletionHooks } from '../../tenancy/domain/tenant-deletion-hooks.js';
import { TenantEvents } from '../domain/tenant-events.js';
import { TENANT_EVENTS_QUEUE, type TenantEventJob } from './outbox-relay.js';

// Runs an event's listeners. One that keeps failing sends the event to tenant-events-dlq for inspection and replay.
@Processor(TENANT_EVENTS_QUEUE)
export class TenantEventsWorker extends DeadLetteringWorker<TenantEventJob> {
  constructor(
    @InjectQueue(TENANT_EVENTS_QUEUE) queue: Queue<TenantEventJob>,
    @InjectQueue(deadLetterQueueName(TENANT_EVENTS_QUEUE)) dlq: Queue<DeadLetterRecord<TenantEventJob>>,
    config: ConfigService,
    @Inject(REDIS_CLIENT) redis: Redis,
    deletionHooks: TenantDeletionHooks,
    private readonly events: TenantEvents,
  ) {
    super(queue, dlq, config, redis, deletionHooks);
  }

  process({ data }: Job<TenantEventJob>): Promise<void> {
    return this.events.dispatch({ ...data, occurredAt: new Date(data.occurredAt) });
  }
}
