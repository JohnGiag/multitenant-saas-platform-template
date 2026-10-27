import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import { redisConnection } from '../../infrastructure/redis/redis-connection.js';
import { jobConfig } from './job-config.js';

export const deadLetterQueueName = (queue: string) => `${queue}-dlq`;

// Shared BullMQ setup, ported from nestjs-fault-tolerant-queue.
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Required by BullMQ workers: their blocking commands must wait out a Redis outage, not error.
        // BullMQ's own options type (it accepts `url`), not the ioredis one redisConnection returns.
        connection: { ...redisConnection(config), maxRetriesPerRequest: null } as ConnectionOptions,
        prefix: jobConfig(config).prefix,
      }),
    }),
  ],
})
export class JobsModule {
  // A queue with the shared retry policy, plus its dead-letter queue `<name>-dlq`. No worker
  // consumes the DLQ: entries wait there for inspection and manual replay.
  static registerQueue(name: string): DynamicModule {
    return BullModule.registerQueueAsync(
      {
        name,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const { attempts, backoffMs } = jobConfig(config);
          return {
            defaultJobOptions: {
              attempts,
              // Retry n waits a random 50-100% of backoffMs × 2^(n-1): a struggling downstream gets
              // breathing room, and jobs that failed together (an outage) do not all retry at once.
              backoff: { type: 'exponential', delay: backoffMs, jitter: 0.5 },
              // A fixed count, not an age: memory must not grow with traffic.
              removeOnComplete: { count: 1000 },
              // Kept until DeadLetteringWorker has safely copied them to the DLQ.
              removeOnFail: false,
            },
          };
        },
      },
      {
        name: deadLetterQueueName(name),
        useFactory: () => ({ defaultJobOptions: { removeOnComplete: false, removeOnFail: false } }),
      },
    );
  }
}
