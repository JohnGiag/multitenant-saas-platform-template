import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmPasswordReset, requestPasswordReset } from '../actions';

export const metadata: Metadata = { title: 'Reset password' };

// Without a token: ask for a reset link. With one (APP_URL/reset-password?token=… from the email): set the password.
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const { token } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Reset your password</h1>
        </CardTitle>
        <CardDescription>
          {typeof token === 'string' ? 'Choose a new password.' : 'We will email you a link to choose a new password.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {typeof token === 'string' ? (
          <ActionForm action={confirmPasswordReset} submitLabel="Change password">
            <input type="hidden" name="token" value={token} />
            <Field id="password" name="password" label="New password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
          </ActionForm>
        ) : (
          <ActionForm action={requestPasswordReset} submitLabel="Send link">
            <Field id="tenantId" name="tenantId" label="Tenant ID" required autoComplete="organization" spellCheck={false} />
            <Field id="email" name="email" label="Email" type="email" required autoComplete="username" />
          </ActionForm>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/login" className="text-sm underline underline-offset-4">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
