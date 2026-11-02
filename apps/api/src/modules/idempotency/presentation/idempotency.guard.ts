import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  SetMetadata,
  UnprocessableEntityException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { decideRetry, type IdempotencyClaim } from '../domain/idempotency-policy.js';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from '../domain/ports/idempotency-store.port.js';

export const IDEMPOTENT_KEY = 'idempotency:route';
export interface IdempotentOptions {
  // The response holds something shown once (a key, a signed URL): it is never stored, and a retry gets a 409.
  secret?: boolean;
}
// A client retrying with the same Idempotency-Key gets the first response back instead of a second change.
export const Idempotent = (options: IdempotentOptions = {}) => SetMetadata(IDEMPOTENT_KEY, options);

export interface IdempotentRequest extends AuthenticatedRequest {
  tenantId?: string;
  path: string;
  body?: unknown;
  idempotency?: { claim: IdempotencyClaim; secret: boolean } | { replay: unknown };
}

const MAX_KEY_LENGTH = 255;
// Taking over a row can lose to another request, which then answers for the key.
const MAX_TRIES = 3;

// Registered after TenantContextGuard, since a key belongs to a tenant. A guard because it rejects: on an interceptor a
// 409 would come after the handler started. IdempotencyInterceptor stores the response.
@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<IdempotentOptions | undefined>(IDEMPOTENT_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<IdempotentRequest>();
    const key = req.headers['idempotency-key'];
    if (!options || key === undefined || !req.principal) return true;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(`Idempotency-Key must be 1 to ${MAX_KEY_LENGTH} characters`);
    }
    const requestHash = createHash('sha256').update(JSON.stringify([req.method, req.path, req.body])).digest('hex');
    const claim = { tenantId: req.tenantId!, key, principalId: req.principal.id, requestHash };

    for (let i = 0; i < MAX_TRIES; i++) {
      if (await this.store.reserve(claim)) {
        req.idempotency = { claim, secret: options.secret ?? false };
        return true;
      }
      const record = await this.store.find(claim.tenantId, key);
      if (!record) continue;
      switch (decideRetry(record, claim, Date.now())) {
        case 'replay':
          req.idempotency = { replay: record.responseBody };
          return true;
        case 'take_over':
          if (await this.store.takeOver(record, claim)) {
            req.idempotency = { claim, secret: options.secret ?? false };
            return true;
          }
          break;
        case 'in_progress':
          throw new ConflictException('A request with this Idempotency-Key is still running');
        case 'secret':
          throw new ConflictException('Already done, and its response was shown once: this key cannot repeat it');
        case 'mismatch':
          throw new UnprocessableEntityException('This Idempotency-Key was used for a different request');
      }
    }
    throw new ConflictException('A request with this Idempotency-Key is still running');
  }
}
