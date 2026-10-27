import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';
import { redisConnection } from './redis-connection.js';

export const REDIS_CLIENT = Symbol('RedisClient');

const logger = new Logger('Redis');

// Ported from nestjs-redis-rate-limiter. Tuned for request-path use (fail fast); BullMQ opens its
// own connections (JobsModule) because workers need the opposite: wait out an outage.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const options: RedisOptions = {
          // Fail fast in an outage; the default (20) queues each command for ~70s of reconnect retries.
          maxRetriesPerRequest: 1,
          // A frozen Redis or a network partition keeps the socket open but silent: without this, requests hang.
          commandTimeout: 500,
          // Give up on an unreachable host after 1 s (default 10 s), e.g. a primary that just died.
          connectTimeout: 1000,
          // Connect on the first command: startup never waits on Redis, and an app that fails to boot holds no socket.
          lazyConnect: true,
        };
        const connection = redisConnection(config);
        const redis =
          'url' in connection
            ? new Redis(connection.url as string, options)
            : new Redis({ ...connection, ...options });
        redis.on('error', (err: Error) => logger.error(err.message));
        return redis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // QUIT fails while Redis is unreachable; drop the socket instead of failing the shutdown.
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
