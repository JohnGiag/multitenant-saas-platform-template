'use server';

import {
  AcceptInvitationSchema,
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  SignInSchema,
  type AcceptedInvitation,
  type AuthToken,
} from '@repo/shared-types';
import { redirect } from 'next/navigation';
import { apiFailure, publicApi } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { endSession, startSession } from '@/lib/session';

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SignInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  let token: AuthToken;
  try {
    token = await publicApi<AuthToken>('/auth/login', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  await startSession(token);
  redirect('/');
}

export async function signOut(): Promise<void> {
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
  redirect(`/login?${new URLSearchParams(account)}`);
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await publicApi('/auth/password-reset', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  return { success: 'If that account exists, we have emailed it a link to choose a new password.' };
}

export async function confirmPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetConfirmSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await publicApi('/auth/password-reset/confirm', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  return { success: 'Your password has been changed. You can now sign in.' };
}
