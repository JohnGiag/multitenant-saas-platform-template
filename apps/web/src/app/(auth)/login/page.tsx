import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { signIn } from '../actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Prefilled after accepting an invitation.
  const { tenantId, email } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>Your tenant ID is in your invitation email.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={signIn} submitLabel="Sign in">
          <Field id="tenantId" name="tenantId" label="Tenant ID" required defaultValue={typeof tenantId === 'string' ? tenantId : undefined} autoComplete="organization" spellCheck={false} />
          <Field id="email" name="email" label="Email" type="email" required defaultValue={typeof email === 'string' ? email : undefined} autoComplete="username" />
          <Field id="password" name="password" label="Password" type="password" required autoComplete="current-password" />
        </ActionForm>
      </CardContent>
      <CardFooter>
        <Link href="/reset-password" className="text-sm underline underline-offset-4">
          Forgot your password?
        </Link>
      </CardFooter>
    </Card>
  );
}
