import type { z } from 'zod';

// What a server action hands back to its form.
export type FormState = { error?: string; success?: string } | undefined;

export function invalid(error: z.ZodError): FormState {
  const issue = error.issues[0];
  return { error: issue ? `${issue.path.join('.') || 'Input'}: ${issue.message}` : 'Invalid input' };
}

// A form's Idempotency-Key, rendered by the server (components/idempotency-key.tsx) and sent by its action, so a
// resubmission after a request that timed out is the same request and is applied once. The page a success
// re-renders brings a new one: an action that sends it revalidates its page.
export const IDEMPOTENCY_KEY_FIELD = 'idempotencyKey';
export const idempotencyKeyOf = (form: FormData) => String(form.get(IDEMPOTENCY_KEY_FIELD) ?? '') || undefined;
