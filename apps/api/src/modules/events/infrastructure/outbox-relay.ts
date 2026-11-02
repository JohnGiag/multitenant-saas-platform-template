import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { Queue } from 'bullmq';
import { withTimeout } from '../../../common/with-timeout.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { QUEUE_TIMEOUT_MS } from '../../jobs/job-config.js';

export const TENANT_EVENTS_QUEUE = 'tenant-events';

// One event for the listeners. The tenant is in the payload, as in every job.
export interface TenantEventJob {
  id: string;
  type: string;
  tenantId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

const POLL_MS = 500;
const BATCH_SIZE = 50;
const RETRY_MS = 30_000;
// More than the shared 3, about 6 minutes in all: a short database outage must not dead-letter every event in flight.
const LISTENER_ATTEMPTS = 10;

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  data: Record<string, unknown>;
  occurred_at: Date;
  trace_context: Record<string, string>;
}

// Moves outbox_events into the tenant-events queue, at least once and in no guaranteed order; TenantEventsWorker takes
// it from there. An event stays in the table until Redis has it, however long that takes: a dead-letter queue lives in
// Redis too, so it could not hold what is waiting for Redis. Polls rather than using LISTEN, which transaction-mode
// poolers do not support. Every instance runs one: SKIP LOCKED gives each its own rows.
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OutboxRelay');
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TENANT_EVENTS_QUEUE) private readonly queue: Queue<TenantEventJob>,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.drain().then((nextDelayMs) => this.schedule(nextDelayMs));
    }, delayMs);
  }

  private async drain(): Promise<number> {
    try {
      while (!this.stopped && (await this.moveBatch()) === BATCH_SIZE);
      return POLL_MS;
    } catch (err) {
      this.logger.error(`Outbox not drained, will retry: ${err instanceof Error ? err.message : String(err)}`);
      return RETRY_MS;
    }
  }

  // The one read across tenants (see CLAUDE.md): rows go only to a job carrying their own tenant id. A claim holds no
  // transaction open while queueing, and its 30 seconds outlast the queue timeout, so another instance does not pick up
  // an event still being queued. One add per event, not addBulk, so each keeps the trace of its own request.
  private async moveBatch(): Promise<number> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      WITH due AS (
        SELECT id FROM outbox_events
        WHERE next_attempt_at <= now()
        ORDER BY next_attempt_at, id
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events AS event
      SET next_attempt_at = now() + interval '30 seconds'
      FROM due
      WHERE event.id = due.id
      RETURNING event.id, event.tenant_id, event.type, event.data, event.occurred_at, event.trace_context`;
    if (rows.length === 0) return 0;
    const queued = rows.map((row) => context.with(propagation.extract(ROOT_CONTEXT, row.trace_context), () => this.enqueue(row)));
    await withTimeout(Promise.all(queued), QUEUE_TIMEOUT_MS, 'Queueing tenant events');
    await this.prisma.outboxEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return rows.length;
  }

  private enqueue({ id, tenant_id: tenantId, type, data, occurred_at: occurredAt }: OutboxRow) {
    // From the row, so a retry is the same job and receivers can drop a duplicate.
    const eventId = `evt_${id}`;
    const job = { id: eventId, type, tenantId, occurredAt: occurredAt.toISOString(), data };
    return this.queue.add(type, job, { jobId: eventId, attempts: LISTENER_ATTEMPTS });
  }
}
