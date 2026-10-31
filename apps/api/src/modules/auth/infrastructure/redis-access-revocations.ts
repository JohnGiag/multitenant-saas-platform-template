import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import type { AccessRevocations, RevocationScope } from '../domain/ports/access-revocations.port.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../domain/refresh-token.js';

const key = (scope: RevocationScope, id: string) => `auth:revoked:${scope}:${id}`;
// A key outlives every token it could refuse (with a margin for clock skew), so memory stays bounded.
const TTL_MS = (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000;

@Injectable()
export class RedisAccessRevocations implements AccessRevocations {
  private readonly logger = new Logger('AccessRevocations');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async revoke(scope: RevocationScope, id: string): Promise<void> {
    try {
      await this.redis.set(key(scope, id), Date.now(), 'PX', TTL_MS);
    } catch (err) {
      this.logger.error(`Could not revoke ${scope} ${id}, its tokens expire on their own: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async isRevoked({ tenantId, userId, sessionId, issuedAtMs }: Parameters<AccessRevocations['isRevoked']>[0]): Promise<boolean> {
    try {
      const revokedAt = await this.redis.mget(key('tenant', tenantId), key('user', userId), key('session', sessionId));
      return revokedAt.some((at) => at !== null && issuedAtMs <= Number(at));
    } catch (err) {
      // Same choice as rate limiting: signed-in callers keep working through a Redis outage.
      this.logger.error(`Revocation check failed, failing open: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
