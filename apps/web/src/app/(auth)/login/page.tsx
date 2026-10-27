import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
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
