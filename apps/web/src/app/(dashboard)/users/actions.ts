'use server';

import { CreateInvitationSchema, IdSchema, UpdateUserSchema } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';

// Ids arrive bound from the page but come back from the browser, so they are checked again here.
async function run(call: () => Promise<unknown>, success: string): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/users');
  return { success };
}

export async function changeRole(userId: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = UpdateUserSchema.safeParse({ role: form.get('role') });
  if (!parsed.success) return invalid(parsed.error);
  return run(() => api(`/users/${IdSchema.parse(userId)}`, { method: 'PATCH', body: parsed.data }), (await getT())('users.roleChanged'));
}

export async function removeMember(userId: string): Promise<FormState> {
  return run(() => api(`/users/${IdSchema.parse(userId)}`, { method: 'DELETE' }), (await getT())('users.memberRemoved'));
}

export async function invite(_: FormState, form: FormData): Promise<FormState> {
  const parsed = CreateInvitationSchema.safeParse({ email: form.get('email'), role: form.get('role') || undefined });
  if (!parsed.success) return invalid(parsed.error);
  return run(() => api('/invitations', { method: 'POST', body: parsed.data }), (await getT())('users.invitationSent', { email: parsed.data.email }));
}

export async function resendInvitation(invitationId: string): Promise<FormState> {
  return run(() => api(`/invitations/${IdSchema.parse(invitationId)}/resend`, { method: 'POST' }), (await getT())('users.linkResent'));
}

export async function revokeInvitation(invitationId: string): Promise<FormState> {
  return run(() => api(`/invitations/${IdSchema.parse(invitationId)}`, { method: 'DELETE' }), (await getT())('users.invitationRevoked'));
}
