'use server';

import { IdSchema, IntegrationProviderSchema, UpdateTenantSchema, UpsertTenantIntegrationSchema } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';
import { INTEGRATION_FIELDS } from '@/lib/integration-fields';
import { setTenantOverride } from '@/lib/session';

// null: back to the caller's own tenant. The API refuses X-Tenant-Id from anyone but a SuperAdmin.
export async function switchTenant(tenantId: string | null): Promise<void> {
  await setTenantOverride(tenantId === null ? null : IdSchema.parse(tenantId));
  revalidatePath('/', 'layout');
}

export async function renameTenant(_: FormState, form: FormData): Promise<FormState> {
  const parsed = UpdateTenantSchema.safeParse({ name: form.get('name') });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api('/tenants/current', { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/', 'layout');
  return { success: (await getT())('common.saved') };
}

export async function saveIntegration(provider: string, _: FormState, form: FormData): Promise<FormState> {
  const fields = INTEGRATION_FIELDS[provider];
  let config: unknown;
  if (fields) {
    config = Object.fromEntries(fields.flatMap(({ name }) => (form.get(name) ? [[name, String(form.get(name)).trim()]] : [])));
  } else {
    try {
      config = JSON.parse(String(form.get('config') ?? ''));
    } catch {
      return { error: (await getT())('integration.invalidJson') };
    }
  }
  const parsed = UpsertTenantIntegrationSchema.safeParse({ config, enabled: form.get('enabled') === 'on' });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api(`/integrations/${IntegrationProviderSchema.parse(provider)}`, { method: 'PUT', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/', 'layout');
  return { success: (await getT())('common.saved') };
}

export async function removeIntegration(provider: string): Promise<FormState> {
  try {
    await api(`/integrations/${IntegrationProviderSchema.parse(provider)}`, { method: 'DELETE' });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/', 'layout');
  return { success: (await getT())('integration.removed') };
}
