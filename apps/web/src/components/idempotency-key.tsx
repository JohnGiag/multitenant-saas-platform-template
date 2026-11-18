import { IDEMPOTENCY_KEY_FIELD } from '@/lib/form-state';

// Made where the form is rendered on the server. A client form gets `value` from its page instead, since the
// browser would make a different one while hydrating.
export function IdempotencyKey({ value = crypto.randomUUID() }: { value?: string }) {
  return <input type="hidden" name={IDEMPOTENCY_KEY_FIELD} value={value} />;
}
