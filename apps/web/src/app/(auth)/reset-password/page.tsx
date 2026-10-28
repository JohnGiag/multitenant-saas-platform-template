import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { confirmPasswordReset, requestPasswordReset } from '../actions';

export const generateMetadata = pageTitle('reset.title');

// Without a token: ask for a reset link. With one (APP_URL/reset-password?token=… from the email): set the password.
// Local mode only: Clerk's sign-in has its own "Forgot password".
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  // searchParams first: it makes the page render per request, so a Clerk-mode 404 is never baked in at build.
  const { token } = await searchParams;
  if (CLERK) notFound();
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('reset.heading')}</h1>
        </CardTitle>
        <CardDescription>
          {typeof token === 'string' ? t('reset.chooseNew') : t('reset.willEmail')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {typeof token === 'string' ? (
          <ActionForm action={confirmPasswordReset} submitLabel={t('common.changePassword')}>
            <input type="hidden" name="token" value={token} />
            <Field id="password" name="password" label={t('common.newPassword')} type="password" required minLength={12} autoComplete="new-password" hint={t('common.passwordHint')} />
          </ActionForm>
        ) : (
          <ActionForm action={requestPasswordReset} submitLabel={t('reset.sendLink')}>
            <Field id="email" name="email" label={t('common.email')} type="email" required autoComplete="username" />
          </ActionForm>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/login" className="text-sm underline underline-offset-4">
          {t('reset.back')}
        </Link>
      </CardFooter>
    </Card>
  );
}
