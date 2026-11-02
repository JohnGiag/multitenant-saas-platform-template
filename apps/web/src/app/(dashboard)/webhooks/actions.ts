'use server';

import {
  CreateWebhookEndpointSchema,
  IdSchema,
  type CreatedWebhookEndpoint,
  type WebhookSecret,
} from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';

// `secret` reaches the browser exactly once, in this action's response; it is never stored or rendered again.
export type SecretState = (NonNullable<FormState> & { secret?: string }) | undefined;

export async function createEndpoint(_: SecretState, form: FormData): Promise<SecretState> {
  const parsed = CreateWebhookEndpointSchema.safeParse({
    url: form.get('url'),
    description: form.get('description') || undefined,
    events: form.getAll('events'),
  });
  if (!parsed.success) return invalid(parsed.error);
  let created: CreatedWebhookEndpoint;
  try {
    created = await api<CreatedWebhookEndpoint>('/webhooks', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/webhooks');
  return { secret: created.secret };
}

export async function rotateSecret(id: string): Promise<SecretState> {
  try {
    const { secret } = await api<WebhookSecret>(`/webhooks/${IdSchema.parse(id)}/rotate-secret`, { method: 'POST' });
    return { secret };
  } catch (error) {
    return apiFailure(error);
  }
}

async function run(call: () => Promise<unknown>, success: string): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/webhooks');
  return { success };
}

export async function sendTest(id: string): Promise<FormState> {
  return run(() => api(`/webhooks/${IdSchema.parse(id)}/test`, { method: 'POST' }), (await getT())('webhooks.testSent'));
}

export async function redeliver(endpointId: string, deliveryId: string): Promise<FormState> {
  try {
    await api(`/webhook-deliveries/${IdSchema.parse(deliveryId)}/redeliver`, { method: 'POST' });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath(`/webhooks/${IdSchema.parse(endpointId)}`);
  return { success: (await getT())('webhooks.redelivered') };
}

export async function setEnabled(id: string, enabled: boolean): Promise<FormState> {
  const t = await getT();
  return run(
    () => api(`/webhooks/${IdSchema.parse(id)}`, { method: 'PATCH', body: { enabled } }),
    t(enabled ? 'webhooks.turnedOn' : 'webhooks.turnedOff'),
  );
}

export async function deleteEndpoint(id: string): Promise<FormState> {
  return run(() => api(`/webhooks/${IdSchema.parse(id)}`, { method: 'DELETE' }), (await getT())('webhooks.deleted'));
}
