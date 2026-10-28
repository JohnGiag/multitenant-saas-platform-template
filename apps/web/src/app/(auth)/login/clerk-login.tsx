import { OrganizationList, OrganizationSwitcher, SignIn, SignOutButton, TaskChooseOrganization } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { apiAcceptsSession } from '@/lib/api';
import { clerkLoginStep } from '@/lib/clerk-login-step';
import { getT } from '@/lib/i18n';

// Clerk mode's /login. A tenant is a Clerk Organization, so the API needs one active in the session; and it knows
// a member only once Clerk's webhooks have reached it. Which screen each state gets: clerkLoginStep (tested).
export async function ClerkLogin() {
  // Pending sessions count as signed in (see clerkLoginStep).
  const step = await clerkLoginStep(await auth({ treatPendingAsSignedOut: false }), apiAcceptsSession);
  const t = await getT();
  if (step === 'sign-in') {
    // Path routing (Clerk's default for Next.js): every step, second factor or forgotten password, has its own URL
    // under /login, served by the catch-all page. Hash routing could leave the component stuck on a step.
    // withSignUp off: an unknown email says "Couldn't find your account" instead of silently becoming a sign-up.
    // Members join through organization invitations, never by signing up here.
    return <SignIn path="/login" forceRedirectUrl="/signed-in" withSignUp={false} />;
  }
  if (step === 'organization-task' || step === 'choose-organization') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t('clerk.chooseTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('clerk.chooseText')}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'organization-task' ? (
            <TaskChooseOrganization redirectUrlComplete="/signed-in" />
          ) : (
            <OrganizationList hidePersonal afterSelectOrganizationUrl="/signed-in" />
          )}
        </CardContent>
      </Card>
    );
  }
  if (step === 'dashboard') redirect('/');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('clerk.notSetUpTitle')}</h1>
        </CardTitle>
        <CardDescription>{t('clerk.notSetUpText')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/signed-in" />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">{t('common.tryAgain')}</Link>
        </Button>
        <SignOutButton redirectUrl="/login">
          <Button variant="outline">{t('common.signOut')}</Button>
        </SignOutButton>
      </CardFooter>
    </Card>
  );
}
