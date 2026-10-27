'use client';

import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { RoleSelect } from '@/components/role-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createApiKey, type CreateApiKeyState } from './actions';

export function CreateApiKeyForm() {
  const [state, formAction, pending] = useActionState<CreateApiKeyState, FormData>(createApiKey, undefined);
  // Tied to the key it is about, so a newer key never shows the previous one's "Copied".
  const [copied, setCopied] = useState<{ key: string; message: string }>();

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied({ key, message: 'Copied to the clipboard.' });
    } catch {
      setCopied({ key, message: 'Could not copy: select the key and copy it yourself.' });
    }
  }

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" aria-busy={pending}>
        <Field id="key-name" name="name" label="Name" required maxLength={100} autoComplete="off" />
        <div className="grid gap-2">
          <Label htmlFor="key-role">Role</Label>
          <RoleSelect id="key-role" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Working…' : 'Create key'}
        </Button>
      </form>
      <p aria-live="polite" className="text-sm text-destructive">
        {state?.error}
      </p>
      {/* Alert has role="alert": announced when it appears, and so is the copy result inside it. */}
      {state?.key && (
        <Alert>
          <AlertTitle>Key “{state.name}” created. Copy it now: it will not be shown again.</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>
              Clients send it in the <code>X-API-Key</code> header. Only a hash is stored, so a lost key cannot be recovered: revoke it and
              create a new one.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-2">
                <Label htmlFor="new-key">Your new API key</Label>
                <Input id="new-key" readOnly value={state.key} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
              </div>
              <Button type="button" variant="outline" onClick={() => copy(state.key!)}>
                Copy
              </Button>
            </div>
            <p className="text-sm">{copied?.key === state.key && copied.message}</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
