'use server';

import { SendNotificationSchema, type SendNotificationResult } from '@repo/shared-types';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';

export async function sendNotification(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SendNotificationSchema.safeParse({ userId: form.get('userId'), title: form.get('title'), body: form.get('body') });
  if (!parsed.success) return invalid(parsed.error);
  let result: SendNotificationResult;
  try {
    result = await api<SendNotificationResult>('/notifications', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  const queued = result.queued.length ? `Queued for ${result.queued.join(', ')}.` : 'No email or push channel is set up for this tenant.';
  return { success: `${queued} ${result.realtime ? 'Sent in real time.' : 'Real-time delivery failed.'}` };
}
