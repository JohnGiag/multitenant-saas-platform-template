'use server';

import { SendNotificationSchema, type SendNotificationResult } from '@repo/shared-types';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';

export async function sendNotification(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SendNotificationSchema.safeParse({ userId: form.get('userId'), title: form.get('title'), body: form.get('body') });
  if (!parsed.success) return invalid(parsed.error);
  let result: SendNotificationResult;
  try {
    result = await api<SendNotificationResult>('/notifications', { method: 'POST', body: parsed.data });
  } catch (error) {
    return apiFailure(error);
  }
  const t = await getT();
  const queued = result.queued.length ? t('notifications.queued', { channels: result.queued.join(', ') }) : t('notifications.noChannel');
  return { success: `${queued} ${result.realtime ? t('notifications.realtime') : t('notifications.realtimeFailed')}` };
}
