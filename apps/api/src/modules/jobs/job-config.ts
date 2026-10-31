import type { ConfigService } from '@nestjs/config';

// How long a request waits on a queue. Queue connections wait out a Redis outage, which a request must not.
export const QUEUE_TIMEOUT_MS = 2000;

// Ported from nestjs-fault-tolerant-queue: a malformed value stops the app at boot, not at the first job.
function positiveInt(config: ConfigService, name: string, fallback: number): number {
  const raw = config.get<string>(name);
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export const jobConfig = (config: ConfigService) => ({
  // Total attempts per job, including the first.
  attempts: positiveInt(config, 'JOB_ATTEMPTS', 3),
  // Base delay of the exponential backoff.
  backoffMs: positiveInt(config, 'JOB_BACKOFF_MS', 1000),
  // Jobs each instance runs at once (async I/O, not threads); total = replicas × this.
  concurrency: positiveInt(config, 'WORKER_CONCURRENCY', 5),
  // Newest entries kept per DLQ; older ones are dropped so one broken tenant config cannot fill Redis.
  maxDeadLetters: positiveInt(config, 'DLQ_MAX_ENTRIES', 10_000),
  // Namespaces queue keys, e.g. for several environments on one Redis.
  prefix: config.get<string>('QUEUE_PREFIX') || 'bull',
});
