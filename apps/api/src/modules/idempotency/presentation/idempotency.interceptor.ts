import { Inject, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { catchError, mergeMap, of, type Observable } from 'rxjs';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from '../domain/ports/idempotency-store.port.js';
import type { IdempotentRequest } from './idempotency.guard.js';

// Registered before AuditInterceptor, so a replay, which changes nothing, is not audited as a write.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');

  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const state = ctx.switchToHttp().getRequest<IdempotentRequest>().idempotency;
    if (!state) return next.handle();
    if ('replay' in state) return of(state.replay);
    const { tenantId, key } = state.claim;
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        // The change is done: failing the response now would only make the client repeat it.
        await this.store
          .finish(tenantId, key, state.secret ? 'secret' : 'done', state.secret ? undefined : body)
          .catch((err: unknown) => this.logger.error(`Response not stored for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`));
        return body;
      }),
      catchError(async (error: unknown) => {
        await this.store.release(tenantId, key).catch((err: unknown) => this.logger.error(`Key not released for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`));
        throw error;
      }),
    );
  }
}
