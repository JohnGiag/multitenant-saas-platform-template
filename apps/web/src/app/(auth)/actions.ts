'use server';

import {
  AcceptInvitationSchema,
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  SignInSchema,
  type AcceptedInvitation,
  type SignInResult,
  type TenantChoice,
} from '@repo/shared-types';
import { redirect } from 'next/navigation';
import { apiFailure, publicApi } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';
import { endSession, getRefreshToken, startSession } from '@/lib/session';

// `tenants`: the password matched accounts in several tenants; the form asks which, for this `email`.
export type SignInState = (NonNullable<FormState> & Partial<TenantChoice> & { email?: string }) | undefined;

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    tenantId: form.get('tenantId') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);
  let result: SignInResult;
  try {
    result = await publicApi<SignInResult>('/auth/login', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  // Never the password: the browser still has it in the form.
  if ('tenants' in result) return { tenants: result.tenants, email: parsed.data.email };
  await startSession(result);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const refreshToken = await getRefreshToken();
  // Best effort: the API unreachable must not keep anyone signed in on this browser.
  if (refreshToken) await publicApi('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
  await endSession();
  redirect('/login');
}

export async function acceptInvitation(_: FormState, form: FormData): Promise<FormState> {
  const parsed = AcceptInvitationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  let account: AcceptedInvitation;
  try {
    account = await publicApi<AcceptedInvitation>('/invitations/accept', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  redirect(`/login?${new URLSearchParams({ email: account.email })}`);
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await publicApi('/auth/password-reset', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  return { success: (await getT())('reset.sent') };
}

export async function confirmPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetConfirmSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await publicApi('/auth/password-reset/confirm', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  return { success: (await getT())('reset.done') };
}
