import { z } from 'zod';
import { IdSchema } from './common.js';

// FCM rejects these data keys, and a push message over 4096 bytes in total; this keeps data well under it.
const RESERVED_DATA_KEY = /^(from|notification|message_type|(google|gcm)\..*)$/;
const MAX_DATA_BYTES = 1024;

export const SendNotificationSchema = z.object({
  // Recipient: a user of the current tenant.
  userId: IdSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  // Extra key/value pairs for the client; strings only, as FCM requires, without FCM's reserved keys.
  data: z
    .record(
      z
        .string()
        .min(1)
        .max(64)
        .refine((key) => !RESERVED_DATA_KEY.test(key), 'Reserved by FCM'),
      z.string().max(1024),
    )
    .refine((data) => new TextEncoder().encode(JSON.stringify(data)).length <= MAX_DATA_BYTES, {
      message: `data must be at most ${MAX_DATA_BYTES} bytes as JSON`,
    })
    .optional(),
});
export type SendNotificationDto = z.infer<typeof SendNotificationSchema>;
export type Notification = SendNotificationDto;

export const SendNotificationResultSchema = z.object({
  // Durable channels a delivery job was queued for (installed and configured for this tenant).
  queued: z.array(z.string()),
  // Whether the real-time (SSE) event was published.
  realtime: z.boolean(),
});
export type SendNotificationResult = z.infer<typeof SendNotificationResultSchema>;

export const RegisterPushDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
});
export type RegisterPushDeviceDto = z.infer<typeof RegisterPushDeviceSchema>;
