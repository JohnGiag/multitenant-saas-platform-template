'use server';

import { FeatureFlagKeySchema, IdSchema, IntegrationProviderSchema, UpdateTenantSchema, UpsertTenantIntegrationSchema } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';
import { INTEGRATION_FIELDS } from '@/lib/integration-fields';
import { setTenantOverride, setTestMode } from '@/lib/session';

const OverrideSchema = z.enum(['default', 'on', 'off']);

// null: back to the caller's own tenant. The API refuses X-Tenant-Id from anyone but a SuperAdmin.
export async function switchTenant(tenantId: string | null): Promise<void> {
  await setTenantOverride(tenantId === null ? null : IdSchema.parse(tenantId));
  revalidatePath('/', 'layout');
}

// Back to the overview: the page open now may not exist on the other side (billing has no test mode).
export async function switchTestMode(on: boolean): Promise<void> {
  await setTestMode(on);
  revalidatePath('/', 'layout');
  redirect('/');
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

// The tenant is the one the dashboard has open: api() sends it as X-Tenant-Id, and the API takes this from a SuperAdmin only.
export async function saveFeatureFlag(key: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = OverrideSchema.safeParse(form.get('override'));
  if (!parsed.success) return invalid(parsed.error);
  const path = `/feature-flags/${FeatureFlagKeySchema.parse(key)}`;
  try {
    await (parsed.data === 'default' ? api(path, { method: 'DELETE' }) : api(`${path}/${parsed.data}`, { method: 'PUT' }));
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
