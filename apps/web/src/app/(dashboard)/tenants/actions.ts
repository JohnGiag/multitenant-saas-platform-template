'use server';

import { AdminUpdateTenantSchema, CreateTenantSchema, IdSchema, type Tenant } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, apiFailure, getPrincipal } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
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
    `Tenant “${parsed.data.name}” created. Open it to invite its first TenantAdmin.`,
  );
}

export async function updateTenant(id: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = AdminUpdateTenantSchema.safeParse({ name: form.get('name'), tier: form.get('tier') });
  if (!parsed.success) return invalid(parsed.error);
  return run(() => api(`/tenants/${IdSchema.parse(id)}`, { method: 'PATCH', body: parsed.data, ownTenant: true }), 'Saved.');
}

// Typing the name guards against deleting the wrong row; the API is what actually authorizes it.
export async function deleteTenant(id: string, name: string, _: FormState, form: FormData): Promise<FormState> {
  if (form.get('confirm') !== name) return { error: `Type “${name}” exactly to confirm.` };
  const result = await run(() => api(`/tenants/${IdSchema.parse(id)}`, { method: 'DELETE', ownTenant: true }), `Tenant “${name}” deleted.`);
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
