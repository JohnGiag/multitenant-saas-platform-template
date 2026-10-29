import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import { DeadLetteringWorker, type DeadLetterRecord } from '../../../modules/jobs/dead-lettering.worker.js';
import { deadLetterQueueName } from '../../../modules/jobs/jobs.module.js';
import { TenantDeletionHooks } from '../../../modules/tenancy/domain/tenant-deletion-hooks.js';
import { BILLING_QUEUE, StripeBillingService, type PeriodEndJob } from './stripe-billing.service.js';

@Processor(BILLING_QUEUE)
export class BillingWorker extends DeadLetteringWorker<PeriodEndJob> {
  constructor(
    @InjectQueue(BILLING_QUEUE) queue: Queue<PeriodEndJob>,
    @InjectQueue(deadLetterQueueName(BILLING_QUEUE)) dlq: Queue<DeadLetterRecord<PeriodEndJob>>,
    config: ConfigService,
    @Inject(REDIS_CLIENT) redis: Redis,
    deletionHooks: TenantDeletionHooks,
    private readonly billing: StripeBillingService,
  ) {
    super(queue, dlq, config, redis, deletionHooks);
  }

  async process(job: Job<PeriodEndJob>): Promise<'downgraded' | 'skipped'> {
    const result = await this.billing.endPeriod(job.data.tenantId);
    this.logger.log(`Period end for tenant ${job.data.tenantId}: ${result}`);
    return result;
  }
}
