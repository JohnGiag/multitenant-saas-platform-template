import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { acceptInvitation } from '../actions';

export const generateMetadata = pageTitle('invitation.title');

// The API emails links to APP_URL/accept-invitation?token=… (local mode; Clerk sends its own invitations).
export default async function AcceptInvitationPage({ searchParams }: PageProps<'/accept-invitation'>) {
  // searchParams first: it makes the page render per request, so a Clerk-mode 404 is never baked in at build.
  const { token } = await searchParams;
  if (CLERK) notFound();
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('invitation.heading')}</h1>
        </CardTitle>
        <CardDescription>
          {typeof token === 'string' ? t('invitation.choosePassword') : t('invitation.incomplete')}
        </CardDescription>
      </CardHeader>
      {typeof token === 'string' && (
        <CardContent>
          <ActionForm action={acceptInvitation} submitLabel={t('invitation.createAccount')}>
            <input type="hidden" name="token" value={token} />
            <Field id="password" name="password" label={t('common.password')} type="password" required minLength={12} autoComplete="new-password" hint={t('common.passwordHint')} />
          </ActionForm>
        </CardContent>
      )}
    </Card>
  );
}
