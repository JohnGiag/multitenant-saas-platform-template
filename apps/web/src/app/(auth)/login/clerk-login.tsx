import { OrganizationList, OrganizationSwitcher, SignIn, SignOutButton, TaskChooseOrganization } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { apiAcceptsSession } from '@/lib/api';
import { clerkLoginStep } from '@/lib/clerk-login-step';

// Clerk mode's /login. A tenant is a Clerk Organization, so the API needs one active in the session; and it knows
// a member only once Clerk's webhooks have reached it. Which screen each state gets: clerkLoginStep (tested).
export async function ClerkLogin() {
  // Pending sessions count as signed in (see clerkLoginStep).
  const step = await clerkLoginStep(await auth({ treatPendingAsSignedOut: false }), apiAcceptsSession);
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
            <h1>Choose a tenant</h1>
          </CardTitle>
          <CardDescription>Your account belongs to these organizations. Pick the one to manage.</CardDescription>
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
          <h1>Not set up yet</h1>
        </CardTitle>
        <CardDescription>
          You are signed in, but this organization or your membership has not reached the API yet. Clerk sends it within
          seconds; if it never arrives, check the webhook endpoint in the Clerk dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/signed-in" />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">Try again</Link>
        </Button>
        <SignOutButton redirectUrl="/login">
          <Button variant="outline">Sign out</Button>
        </SignOutButton>
      </CardFooter>
    </Card>
  );
}
