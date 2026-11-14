import { Module } from '@nestjs/common';
import { RATE_LIMITER, WEIGHTED_RATE_LIMITER } from './domain/ports/rate-limiter.port.js';
import { RedisRateLimiter } from './infrastructure/redis-rate-limiter.js';
import { RedisWeightedRateLimiter } from './infrastructure/redis-weighted-rate-limiter.js';
import { RateLimitGuard } from './presentation/rate-limit.guard.js';

// RateLimitGuard is registered globally by AppModule, right after AuthGuard, since it needs the principal.
@Module({
  providers: [
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: WEIGHTED_RATE_LIMITER, useClass: RedisWeightedRateLimiter },
    RateLimitGuard,
  ],
  // RATE_LIMITER also serves limits that need request data, e.g. per-account login attempts.
  exports: [RATE_LIMITER, RateLimitGuard],
})
export class RateLimitModule {}
