'use server';

import { CreateInvitationSchema, IdSchema, UpdateUserSchema } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';

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
  return run(() => api(`/users/${IdSchema.parse(userId)}`, { method: 'PATCH', body: parsed.data }), 'Role changed.');
}

export async function removeMember(userId: string): Promise<FormState> {
  return run(() => api(`/users/${IdSchema.parse(userId)}`, { method: 'DELETE' }), 'Member removed.');
}

export async function invite(_: FormState, form: FormData): Promise<FormState> {
  const parsed = CreateInvitationSchema.safeParse({ email: form.get('email'), role: form.get('role') || undefined });
  if (!parsed.success) return invalid(parsed.error);
  return run(() => api('/invitations', { method: 'POST', body: parsed.data }), `Invitation sent to ${parsed.data.email}.`);
}

export async function resendInvitation(invitationId: string): Promise<FormState> {
  return run(() => api(`/invitations/${IdSchema.parse(invitationId)}/resend`, { method: 'POST' }), 'A new link was sent.');
}

export async function revokeInvitation(invitationId: string): Promise<FormState> {
  return run(() => api(`/invitations/${IdSchema.parse(invitationId)}`, { method: 'DELETE' }), 'Invitation revoked.');
}
