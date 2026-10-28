'use server';

import { CreateApiKeySchema, IdSchema, type CreatedApiKey } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';

// `key` reaches the browser exactly once, in this action's response; it is never stored or rendered again.
export type CreateApiKeyState = (NonNullable<FormState> & { key?: string; name?: string }) | undefined;

export async function createApiKey(_: CreateApiKeyState, form: FormData): Promise<CreateApiKeyState> {
  const parsed = CreateApiKeySchema.safeParse({ name: form.get('name'), role: form.get('role') || undefined });
  if (!parsed.success) return invalid(parsed.error);
  let created: CreatedApiKey;
  try {
    created = await api<CreatedApiKey>('/api-keys', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/api-keys');
  return { key: created.key, name: created.name };
}

export async function revokeApiKey(id: string): Promise<FormState> {
  try {
    await api(`/api-keys/${IdSchema.parse(id)}`, { method: 'DELETE' });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/api-keys');
  return { success: (await getT())('apiKeys.revokedDone') };
}
