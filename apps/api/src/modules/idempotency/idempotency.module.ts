import { Module } from '@nestjs/common';
import { IDEMPOTENCY_STORE } from './domain/ports/idempotency-store.port.js';
import { IdempotencySweep, PrismaIdempotencyStore } from './infrastructure/prisma-idempotency.store.js';
import { IdempotencyGuard } from './presentation/idempotency.guard.js';
import { IdempotencyInterceptor } from './presentation/idempotency.interceptor.js';

@Module({
  providers: [{ provide: IDEMPOTENCY_STORE, useClass: PrismaIdempotencyStore }, IdempotencySweep, IdempotencyGuard, IdempotencyInterceptor],
  // Registered globally by AppModule, like the other guards.
  exports: [IdempotencyGuard, IdempotencyInterceptor],
})
export class IdempotencyModule {}
