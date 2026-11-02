import type { IdempotencyClaim, IdempotencyRecord, IdempotencyStatus } from '../idempotency-policy.js';

export const IDEMPOTENCY_STORE = Symbol('IdempotencyStore');

export interface IdempotencyStore {
  // False when the key already has a row: the unique index decides between concurrent requests.
  reserve(claim: IdempotencyClaim): Promise<boolean>;
  find(tenantId: string, key: string): Promise<IdempotencyRecord | null>;
  // False when another request took it first.
  takeOver(record: IdempotencyRecord, claim: IdempotencyClaim): Promise<boolean>;
  finish(tenantId: string, key: string, status: Exclude<IdempotencyStatus, 'in_progress'>, responseBody?: unknown): Promise<void>;
  // Frees the key of a failed request, so a retry can succeed.
  release(tenantId: string, key: string): Promise<void>;
}
