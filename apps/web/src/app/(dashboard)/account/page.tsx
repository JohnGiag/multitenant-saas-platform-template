import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { changePassword } from './actions';

export const generateMetadata = pageTitle('nav.account');

export default async function AccountPage() {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('common.you')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('common.role')}</dt>
            <dd>{me.role}</dd>
            <dt className="text-muted-foreground">{t('common.tenantId')}</dt>
            <dd className="font-mono break-all">{me.tenantId}</dd>
          </dl>
        </CardContent>
      </Card>
      {CLERK ? (
        <p className="text-sm text-muted-foreground">{t('account.clerk')}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('common.changePassword')}</h2>
            </CardTitle>
            <CardDescription>{t('account.limitNote')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={changePassword} submitLabel={t('common.changePassword')}>
              <Field id="current-password" name="currentPassword" label={t('account.currentPassword')} type="password" required autoComplete="current-password" />
              <Field id="new-password" name="newPassword" label={t('common.newPassword')} type="password" required minLength={12} autoComplete="new-password" hint={t('common.passwordHint')} />
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
