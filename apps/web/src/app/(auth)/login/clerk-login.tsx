import { OrganizationList, OrganizationSwitcher, SignIn, SignOutButton, TaskChooseOrganization } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { apiAcceptsSession } from '@/lib/api';

// Clerk mode's /login. A tenant is a Clerk Organization, so the API needs one active in the session; and it knows
// a member only once Clerk's webhooks have reached it. Each state gets its own screen, never a redirect loop.
export async function ClerkLogin() {
  // A pending session is signed in but owes Clerk a task: choosing an organization, when personal accounts are off
  // (Clerk's default since August 2025). auth() would call it signed out, and showing the sign-in form again to
  // someone Clerk already signed in fails ("already exists"); so it counts as signed in here.
  const { userId, orgId, sessionStatus } = await auth({ treatPendingAsSignedOut: false });
  if (!userId) {
    // Path routing (Clerk's default for Next.js): every step, second factor or forgotten password, has its own URL
    // under /login, served by the catch-all page. Hash routing could leave the component stuck on a step.
    // withSignUp off: an unknown email says "Couldn't find your account" instead of silently becoming a sign-up.
    // Members join through organization invitations, never by signing up here.
    return <SignIn path="/login" forceRedirectUrl="/signed-in" withSignUp={false} />;
  }
  if (sessionStatus === 'pending' || !orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Choose a tenant</h1>
          </CardTitle>
          <CardDescription>Your account belongs to these organizations. Pick the one to manage.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionStatus === 'pending' ? (
            <TaskChooseOrganization redirectUrlComplete="/signed-in" />
          ) : (
            <OrganizationList hidePersonal afterSelectOrganizationUrl="/signed-in" />
          )}
        </CardContent>
      </Card>
    );
  }
  if (await apiAcceptsSession()) redirect('/');
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
