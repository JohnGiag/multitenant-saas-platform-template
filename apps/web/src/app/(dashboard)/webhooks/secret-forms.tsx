'use client';

import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { useT } from '@/components/i18n-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createEndpoint, rotateSecret, type SecretState } from './actions';

// The new signing secret, shown once. Alert has role="alert": announced when it appears, and so is the copy result.
function SecretAlert({ id, secret }: { id: string; secret: string }) {
  const t = useT();
  // Tied to the secret it is about, so a newer secret never shows the previous one's "Copied".
  const [copied, setCopied] = useState<{ secret: string; message: string }>();

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied({ secret, message: t('apiKeys.copied') });
    } catch {
      setCopied({ secret, message: t('apiKeys.copyFailed') });
    }
  }

  return (
    <Alert>
      <AlertTitle>{t('webhooks.secretTitle')}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>{t('webhooks.secretText')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <Label htmlFor={id}>{t('webhooks.secretTitle')}</Label>
            <Input id={id} readOnly value={secret} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          </div>
          <Button type="button" variant="outline" onClick={copy}>
            {t('apiKeys.copy')}
          </Button>
        </div>
        <p className="text-sm">{copied?.secret === secret && copied.message}</p>
      </AlertDescription>
    </Alert>
  );
}

export function CreateEndpointForm({ eventTypes }: { eventTypes: string[] }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<SecretState, FormData>(createEndpoint, undefined);
  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4" aria-busy={pending}>
        <Field id="webhook-url" name="url" type="url" label={t('webhooks.url')} required maxLength={2048} autoComplete="off" placeholder="https://" />
        <Field id="webhook-description" name="description" label={t('webhooks.description')} maxLength={200} autoComplete="off" />
        <fieldset className="grid gap-2" aria-describedby="webhook-events-hint">
          <legend className="mb-1 text-sm font-medium">{t('webhooks.events')}</legend>
          <p id="webhook-events-hint" className="text-sm text-muted-foreground">
            {t('webhooks.eventsHint')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {eventTypes.map((type) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox id={`event-${type}`} name="events" value={type} />
                <Label htmlFor={`event-${type}`} className="font-mono text-sm font-normal">
                  {type}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending ? t('common.working') : t('webhooks.createButton')}
        </Button>
      </form>
      <p aria-live="polite" className="text-sm text-destructive">
        {state?.error}
      </p>
      {state?.secret && <SecretAlert id="new-webhook-secret" secret={state.secret} />}
    </div>
  );
}

export function RotateSecretForm({ id, url }: { id: string; url: string }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<SecretState, FormData>(() => rotateSecret(id), undefined);
  return (
    <div className="grid gap-2">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(t('webhooks.rotateConfirm', { url }))) e.preventDefault();
        }}
        aria-busy={pending}
      >
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? t('common.working') : t('webhooks.rotate')}
        </Button>
      </form>
      {state?.error && (
        <p aria-live="polite" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.secret && <SecretAlert id={`secret-${id}`} secret={state.secret} />}
    </div>
  );
}
