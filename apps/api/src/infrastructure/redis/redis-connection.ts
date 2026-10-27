import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';
import { parseSentinels } from './sentinels.js';

// Where Redis is, shared by the request-path client (RedisModule) and BullMQ, which tune
// retries differently. Sentinel mode follows the primary across failovers; otherwise one REDIS_URL.
export function redisConnection(config: ConfigService): { url: string } | RedisOptions {
  const sentinels = config.get<string>('REDIS_SENTINELS');
  if (!sentinels) return { url: config.getOrThrow<string>('REDIS_URL') };
  return {
    sentinels: parseSentinels(sentinels),
    name: config.getOrThrow<string>('REDIS_SENTINEL_NAME'),
    // REDIS_URL (and the password in it) is unused here, so auth comes from its own variable.
    password: config.get<string>('REDIS_PASSWORD'),
    sentinelPassword: config.get<string>('REDIS_PASSWORD'),
  };
}
