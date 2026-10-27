'use server';

import { ChangePasswordSchema } from '@repo/shared-types';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const parsed = ChangePasswordSchema.safeParse({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
  if (!parsed.success) return invalid(parsed.error);
  try {
    // The caller's own account: the selected tenant (X-Tenant-Id) has nothing to do with it.
    await api('/users/me/password', { method: 'PUT', body: parsed.data, ownTenant: true });
  } catch (error) {
    return apiFailure(error);
  }
  return { success: 'Password changed.' };
}
