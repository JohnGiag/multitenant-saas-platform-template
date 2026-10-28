import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { ClerkLogin } from '../clerk-login';
import { LoginForm } from '../login-form';

export const metadata: Metadata = { title: 'Sign in' };

// A catch-all, so Clerk's sign-in steps each get their own URL under /login (e.g. /login/factor-one).
export default async function LoginPage({ searchParams }: PageProps<'/login/[[...rest]]'>) {
  if (CLERK) return <ClerkLogin />;
  // Prefilled after accepting an invitation.
  const { email } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Sign in</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LoginForm defaultEmail={typeof email === 'string' ? email : undefined} />
      </CardContent>
      <CardFooter>
        <Link href="/reset-password" className="text-sm underline underline-offset-4">
          Forgot your password?
        </Link>
      </CardFooter>
    </Card>
  );
}
