'use client';

import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { FormState } from '@/lib/form-state';
import { cn } from 'cn';

interface ActionFormProps {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: 'default' | 'destructive' | 'outline';
  size?: 'default' | 'sm';
  // Asked before submitting (destructive actions).
  confirm?: string;
  className?: string;
  children?: ReactNode;
}

// A server-action form whose result is announced to screen readers through a live region.
export function ActionForm({ action, submitLabel, variant, size, confirm, className, children }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn('grid gap-4', className)}
      aria-busy={pending}
    >
      {children}
      <p aria-live="polite" className={state?.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {state?.error ?? state?.success}
      </p>
      <Button type="submit" variant={variant} size={size} disabled={pending} className="justify-self-start">
        {pending ? 'Working…' : submitLabel}
      </Button>
    </form>
  );
}
