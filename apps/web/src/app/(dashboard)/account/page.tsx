import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPrincipal } from '@/lib/api';
import { changePassword } from './actions';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const me = await getPrincipal();
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>You</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Role</dt>
            <dd>{me.role}</dd>
            <dt className="text-muted-foreground">Tenant ID</dt>
            <dd className="font-mono break-all">{me.tenantId}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Change password</h2>
          </CardTitle>
          <CardDescription>Wrong guesses count towards the same limit as sign-in attempts.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={changePassword} submitLabel="Change password">
            <Field id="current-password" name="currentPassword" label="Current password" type="password" required autoComplete="current-password" />
            <Field id="new-password" name="newPassword" label="New password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
