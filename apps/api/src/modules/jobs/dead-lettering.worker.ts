import { WorkerHost } from '@nestjs/bullmq';
import { Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { TenantDeletionHooks } from '../tenancy/domain/tenant-deletion-hooks.js';
import { jobConfig } from './job-config.js';

const depth = metrics.getMeter('jobs').createObservableGauge('jobs.depth', { description: 'Jobs per queue and state, dead-letter queues included' });

// What lands in a DLQ: enough to diagnose the failure and replay the original payload.
export interface DeadLetterRecord<T> {
  originalJobId: string;
  originalQueue: string;
  jobName: string;
  payload: T;
  failedReason: string;
  stacktrace: string | undefined;
  // Stacks of every failed attempt, oldest first, as recorded by BullMQ.
  attemptStacktraces: string[];
  attemptsMade: number;
  maxAttempts: number;
  // The job's own options, so a replay can restore them (BullMQ keeps them only on the dead job).
  jobOptions: { attempts?: number; delay?: number; priority?: number };
  enqueuedAt: string;
  failedAt: string;
}

// Base for every worker, ported from nestjs-fault-tolerant-queue's QueueWorker: a thrown error fails
// the attempt and BullMQ retries with backoff; once it gives up, the job is copied to the DLQ.
// Every payload carries its tenant, so a deleted tenant's jobs can be found and dropped.
export abstract class DeadLetteringWorker<T extends { tenantId: string }>
  extends WorkerHost
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly sourceQueue: Queue<T>,
    private readonly dlq: Queue<DeadLetterRecord<T>>,
    private readonly config: ConfigService,
    // The fail-fast request-path client (REDIS_CLIENT), used only to check Redis at shutdown.
    private readonly redis: Redis,
    deletionHooks: TenantDeletionHooks,
  ) {
    super();
    deletionHooks.register((tenantId) => this.forgetTenant(tenantId));
  }

  // A deleted tenant's pending, retrying and dead-lettered jobs go too: their payloads hold its data.
  // A job already running finishes, and then finds the tenant's secrets gone.
  // shortcut: loads every pending and dead-lettered job to filter by tenant; fine for a rare deletion,
  // index jobs by tenant if queues hold millions.
  async forgetTenant(tenantId: string): Promise<void> {
    const pending = await this.sourceQueue.getJobs(['wait', 'delayed', 'prioritized', 'failed']);
    const dead = await this.dlq.getJobs(['wait']);
    await Promise.all([
      // A job a worker picked up since the listing is locked and cannot be removed: it runs, finds the
      // tenant's secrets gone, and skips. Not a reason to abort the tenant's deletion.
      ...pending
        .filter((job) => job?.data.tenantId === tenantId)
        .map((job) => job.remove().catch(() => undefined)),
      ...dead.filter((job) => job?.data.payload.tenantId === tenantId).map((job) => job.remove()),
    ]);
  }

  // Runs before @nestjs/bullmq closes workers (onApplicationShutdown). A graceful close lets running
  // jobs finish, but never returns while Redis is unreachable, and once started it cannot be turned
  // into a forced one. So decide first: force only when Redis does not answer; the interrupted jobs
  // are then picked up again as stalled once Redis is back.
  async beforeApplicationShutdown(): Promise<void> {
    depth.removeCallback(this.observeDepth);
    const reachable = await this.redis.ping().then(
      () => true,
      () => false,
    );
    if (!reachable) this.logger.warn('Redis unreachable at shutdown: closing the worker without waiting for jobs');
    await this.worker.close(!reachable);
  }

  onApplicationBootstrap(): void {
    // Set here, not in @Processor: decorators run at import time, before ConfigModule loads .env.
    this.worker.concurrency = jobConfig(this.config).concurrency;
    // Registered directly rather than with @OnWorkerEvent, which subclasses would have to repeat.
    this.worker.on('failed', (job, error) => void this.onFailed(job, error));
    depth.addCallback(this.observeDepth);
    // In the background: the API should not wait for a long failed list to drain.
    void this.deadLetterLeftovers().catch((err: unknown) =>
      this.logger.error(`Failed-set sweep aborted: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  // Queue commands wait out a Redis outage instead of failing, so collecting during one would only pile them up.
  private readonly observeDepth = async (result: ObservableResult): Promise<void> => {
    if (this.redis.status !== 'ready') return;
    for (const queue of [this.sourceQueue, this.dlq]) {
      const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
      for (const [state, count] of Object.entries(counts)) result.observe(count, { queue: queue.name, state });
    }
  };

  // Routes jobs that failed for good but never reached the DLQ: the DLQ write failed (Redis blip),
  // the process died between write and remove, or the job failed during shutdown. Safe on every
  // replica at once: the DLQ job id is fixed per failure, so a second copy is ignored.
  async deadLetterLeftovers(): Promise<void> {
    for (const job of await this.sourceQueue.getFailed(0, -1)) {
      // The original error object is gone; rebuild it from what BullMQ stored.
      const error = new Error(job.failedReason);
      error.stack = job.stacktrace?.at(-1) ?? error.stack;
      // BullMQ's types widen the job's data once T is constrained; it is still a Job<T>.
      await this.onFailed(job as Job<T>, error);
    }
  }

  // Fires after every failed attempt, including ones BullMQ will retry. BullMQ sets finishedOn only
  // when it gives up (attempts exhausted, UnrecoverableError, or too many stalls): the DLQ signal.
  async onFailed(job: Job<T> | undefined, error: Error): Promise<void> {
    if (!job?.id) return;
    if (!job.finishedOn) {
      this.logger.warn(`Job ${job.id} attempt ${job.attemptsMade} failed, will retry: ${error.message}`);
      return;
    }

    const record: DeadLetterRecord<T> = {
      originalJobId: job.id,
      originalQueue: job.queueName,
      jobName: job.name,
      payload: job.data,
      failedReason: error.message,
      stacktrace: error.stack,
      attemptStacktraces: job.stacktrace ?? [],
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      jobOptions: { attempts: job.opts.attempts, delay: job.opts.delay, priority: job.opts.priority },
      enqueuedAt: new Date(job.timestamp).toISOString(),
      failedAt: new Date(job.finishedOn).toISOString(),
    };

    try {
      // Fixed id per failure: a retried copy (sweep, second replica) is a no-op, not a duplicate.
      await this.dlq.add(job.name, record, { jobId: `${job.id}-${job.finishedOn}` });
    } catch (err) {
      // The job stays in the failed set (removeOnFail: false); the startup sweep retries it.
      this.logger.error(
        `Job ${job.id} could not be dead-lettered and remains in "${job.queueName}" failed set: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // Only after the DLQ copy exists: removing first would lose the job if the DLQ write failed.
    await job
      .remove()
      .catch((err: unknown) =>
        this.logger.warn(
          `Job ${job.id} dead-lettered but not removed from "${job.queueName}": ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    // DLQ entries are kept until someone handles them, up to the cap; the size in the log is what to alert on.
    const dlqSize = await this.trimDeadLetters().catch((err: unknown) => {
      this.logger.warn(`DLQ trim failed: ${err instanceof Error ? err.message : String(err)}`);
      return 'unknown';
    });
    this.logger.error(
      `Job ${job.id} dead-lettered after ${job.attemptsMade} attempt(s), DLQ size ${dlqSize}: ${error.message}`,
    );
  }

  // Drops the oldest entries beyond DLQ_MAX_ENTRIES; returns the resulting size.
  private async trimDeadLetters(): Promise<number> {
    const max = jobConfig(this.config).maxDeadLetters;
    const excess = (await this.dlq.count()) - max;
    if (excess <= 0) return max + excess;
    for (const oldest of await this.dlq.getJobs(['wait'], 0, excess - 1, true)) await oldest.remove();
    this.logger.warn(`DLQ "${this.dlq.name}" over ${max} entries: dropped the ${excess} oldest`);
    return max;
  }
}
