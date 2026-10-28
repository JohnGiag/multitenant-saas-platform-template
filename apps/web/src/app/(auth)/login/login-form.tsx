'use client';

import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { signIn, type SignInState } from '../actions';

// Email and password; when they match accounts in several tenants, the same form asks which one and
// submits again with it. Controlled fields, so the password survives that round trip in the browser only.
export function LoginForm({ defaultEmail }: { defaultEmail?: string }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, undefined);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState('');
  // Editing the email after the choice appeared means a different person: start over.
  const tenants = state?.tenants && state.email === email.trim().toLowerCase() ? state.tenants : undefined;

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <Field id="email" name="email" label={t('common.email')} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field
        id="password"
        name="password"
        label={t('common.password')}
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {tenants && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('login.whichTenant')}</legend>
          {tenants.map((tenant, i) => (
            <label key={tenant.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="tenantId" value={tenant.id} required defaultChecked={i === 0} className="size-4 accent-primary" />
              {tenant.name}
            </label>
          ))}
        </fieldset>
      )}
      <p aria-live="polite" className={state?.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {state?.error ?? (tenants && t('login.chooseTenant'))}
      </p>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? t('login.signingIn') : tenants ? t('login.continue') : t('common.signIn')}
      </Button>
    </form>
  );
}
