import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { confirmPasswordReset, requestPasswordReset } from '../actions';

export const metadata: Metadata = { title: 'Reset password' };

// Without a token: ask for a reset link. With one (APP_URL/reset-password?token=… from the email): set the password.
// Local mode only: Clerk's sign-in has its own "Forgot password".
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  // searchParams first: it makes the page render per request, so a Clerk-mode 404 is never baked in at build.
  const { token } = await searchParams;
  if (CLERK) notFound();
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
