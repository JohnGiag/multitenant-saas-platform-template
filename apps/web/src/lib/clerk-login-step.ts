export type ClerkLoginStep = 'sign-in' | 'organization-task' | 'choose-organization' | 'dashboard' | 'not-set-up';

interface ClerkSession {
  userId: string | null;
  orgId?: string | null;
  sessionStatus?: string | null;
}

// What Clerk mode's /login shows. `session` must come from auth({ treatPendingAsSignedOut: false }): a pending session
// (signed in, organization not chosen yet) shown the sign-in form again fails with "already exists". The API is asked
// last, and only then: a signed-in user it does not know yet gets an explanation, never a loop between / and /login.
export async function clerkLoginStep({ userId, orgId, sessionStatus }: ClerkSession, apiAccepts: () => Promise<boolean>): Promise<ClerkLoginStep> {
  if (!userId) return 'sign-in';
  if (sessionStatus === 'pending') return 'organization-task';
  if (!orgId) return 'choose-organization';
  return (await apiAccepts()) ? 'dashboard' : 'not-set-up';
}
