import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { ClerkLogin } from '../clerk-login';
import { LoginForm } from '../login-form';

export const generateMetadata = pageTitle('common.signIn');

// A catch-all, so Clerk's sign-in steps each get their own URL under /login (e.g. /login/factor-one).
export default async function LoginPage({ searchParams }: PageProps<'/login/[[...rest]]'>) {
  if (CLERK) return <ClerkLogin />;
  // Prefilled after accepting an invitation.
  const { email } = await searchParams;
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('common.signIn')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LoginForm defaultEmail={typeof email === 'string' ? email : undefined} />
      </CardContent>
      <CardFooter>
        <Link href="/reset-password" className="text-sm underline underline-offset-4">
          {t('login.forgot')}
        </Link>
      </CardFooter>
    </Card>
  );
}
