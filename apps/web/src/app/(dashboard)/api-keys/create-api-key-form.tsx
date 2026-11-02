'use client';

import { CORE_API_SCOPES } from '@repo/shared-types';
import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { useT } from '@/components/i18n-provider';
import { RoleSelect } from '@/components/choice-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createApiKey, type CreateApiKeyState } from './actions';

export function CreateApiKeyForm({ scopes }: { scopes: string[] }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<CreateApiKeyState, FormData>(createApiKey, undefined);
  // Tied to the key it is about, so a newer key never shows the previous one's "Copied".
  const [copied, setCopied] = useState<{ key: string; message: string }>();

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied({ key, message: t('apiKeys.copied') });
    } catch {
      setCopied({ key, message: t('apiKeys.copyFailed') });
    }
  }

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4" aria-busy={pending}>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="key-name" name="name" label={t('common.name')} required maxLength={100} autoComplete="off" />
          <div className="grid gap-2">
            <Label htmlFor="key-role">{t('common.role')}</Label>
            <RoleSelect id="key-role" />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('apiKeys.scopes')}</legend>
          <div className="flex flex-wrap gap-4">
            {scopes.map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <Checkbox id={`scope-${scope}`} name="scopes" value={scope} defaultChecked={(CORE_API_SCOPES as readonly string[]).includes(scope)} />
                <Label htmlFor={`scope-${scope}`}>{scope}</Label>
              </div>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending ? t('common.working') : t('apiKeys.createButton')}
        </Button>
      </form>
      <p aria-live="polite" className="text-sm text-destructive">
        {state?.error}
      </p>
      {/* Alert has role="alert": announced when it appears, and so is the copy result inside it. */}
      {state?.key && (
        <Alert>
          <AlertTitle>{t('apiKeys.createdTitle', { name: state.name ?? '' })}</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>
              {t('apiKeys.headerIntro')} <code>X-API-Key</code>. {t('apiKeys.hashOnly')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-2">
                <Label htmlFor="new-key">{t('apiKeys.yourNewKey')}</Label>
                <Input id="new-key" readOnly value={state.key} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
              </div>
              <Button type="button" variant="outline" onClick={() => copy(state.key!)}>
                {t('apiKeys.copy')}
              </Button>
            </div>
            <p className="text-sm">{copied?.key === state.key && copied.message}</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
