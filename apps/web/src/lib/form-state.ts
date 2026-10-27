import type { z } from 'zod';

// What a server action hands back to its form.
export type FormState = { error?: string; success?: string } | undefined;

export function invalid(error: z.ZodError): FormState {
  const issue = error.issues[0];
  return { error: issue ? `${issue.path.join('.') || 'Input'}: ${issue.message}` : 'Invalid input' };
}
