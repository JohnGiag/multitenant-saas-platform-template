import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RATE_LIMITER } from './domain/ports/rate-limiter.port.js';
import { RedisRateLimiter } from './infrastructure/redis-rate-limiter.js';
import { RateLimitInterceptor } from './presentation/rate-limit.interceptor.js';

@Module({
  providers: [
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
  ],
  // For limits that need request data, e.g. per-account login attempts.
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
