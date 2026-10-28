'use server';

import { AdminUpdateTenantSchema, CreateTenantSchema, IdSchema, type Tenant } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, apiFailure, getPrincipal } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';
import { getTenantOverride, setTenantOverride } from '@/lib/session';

// The tenant switcher in the layout lists tenants too, so every change refreshes the whole dashboard.
async function run(call: () => Promise<unknown>, success: string): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/', 'layout');
  return { success };
}

export async function createTenant(_: FormState, form: FormData): Promise<FormState> {
  const parsed = CreateTenantSchema.safeParse({ name: form.get('name') });
  if (!parsed.success) return invalid(parsed.error);
  return run(
    () => api<Tenant>('/tenants', { method: 'POST', body: parsed.data, ownTenant: true }),
    (await getT())('tenants.created', { name: parsed.data.name }),
  );
}

export async function updateTenant(id: string, _: FormState, form: FormData): Promise<FormState> {
  // No name field in Clerk mode: the tier alone is sent.
  const parsed = AdminUpdateTenantSchema.safeParse({ name: form.get('name') ?? undefined, tier: form.get('tier') });
  if (!parsed.success) return invalid(parsed.error);
  return run(() => api(`/tenants/${IdSchema.parse(id)}`, { method: 'PATCH', body: parsed.data, ownTenant: true }), (await getT())('common.saved'));
}

// Typing the name guards against deleting the wrong row; the API is what actually authorizes it.
export async function deleteTenant(id: string, name: string, _: FormState, form: FormData): Promise<FormState> {
  const t = await getT();
  if (form.get('confirm') !== name) return { error: t('tenants.confirmMismatch', { name }) };
  const result = await run(() => api(`/tenants/${IdSchema.parse(id)}`, { method: 'DELETE', ownTenant: true }), t('tenants.deleted', { name }));
  // Acting on a tenant that no longer exists would make every page 404.
  if (!result?.error && (await getTenantOverride()) === id) await setTenantOverride(null);
  return result;
}

// Switches the dashboard to this tenant and shows its overview.
export async function openTenant(id: string): Promise<void> {
  const me = await getPrincipal();
  await setTenantOverride(id === me.tenantId ? null : IdSchema.parse(id));
  revalidatePath('/', 'layout');
  redirect('/');
}
