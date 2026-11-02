export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
// A request still "in progress" this long ago lost its process: a crash must not block the key for a whole day.
export const ABANDONED_AFTER_MS = 60_000;

// secret: finished, but its response held something shown once, so only this marker is kept.
export type IdempotencyStatus = 'in_progress' | 'done' | 'secret';
export type IdempotencyDecision = 'take_over' | 'replay' | 'in_progress' | 'mismatch' | 'secret';

export interface IdempotencyClaim {
  tenantId: string;
  key: string;
  principalId: string;
  requestHash: string;
}

export interface IdempotencyRecord {
  id: string;
  principalId: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseBody: unknown;
  createdAt: Date;
}

// What a retry gets, given the row its key already has.
export function decideRetry(record: IdempotencyRecord, claim: IdempotencyClaim, now: number): IdempotencyDecision {
  const age = now - record.createdAt.getTime();
  if (age >= IDEMPOTENCY_TTL_MS) return 'take_over';
  if (record.principalId !== claim.principalId || record.requestHash !== claim.requestHash) return 'mismatch';
  if (record.status === 'done') return 'replay';
  if (record.status === 'secret') return 'secret';
  return age >= ABANDONED_AFTER_MS ? 'take_over' : 'in_progress';
}
