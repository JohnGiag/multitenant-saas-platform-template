import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { acceptInvitation } from '../actions';

export const metadata: Metadata = { title: 'Accept invitation' };

// The API emails links to APP_URL/accept-invitation?token=… (local mode; Clerk sends its own invitations).
export default async function AcceptInvitationPage({ searchParams }: PageProps<'/accept-invitation'>) {
  // searchParams first: it makes the page render per request, so a Clerk-mode 404 is never baked in at build.
  const { token } = await searchParams;
  if (CLERK) notFound();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Accept your invitation</h1>
        </CardTitle>
        <CardDescription>
          {typeof token === 'string' ? 'Choose a password to create your account.' : 'This link is incomplete. Open the link from your invitation email again.'}
        </CardDescription>
      </CardHeader>
      {typeof token === 'string' && (
        <CardContent>
          <ActionForm action={acceptInvitation} submitLabel="Create account">
            <input type="hidden" name="token" value={token} />
            <Field id="password" name="password" label="Password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
          </ActionForm>
        </CardContent>
      )}
    </Card>
  );
}
