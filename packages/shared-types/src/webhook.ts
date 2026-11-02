import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';

// "member.joined", "badge.earned": dot-separated lowercase words. Optional modules and projects add their own.
export const EventTypeSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Must look like "member.joined"');

// The events core publishes. Payloads carry ids and roles only, never emails or names.
export const CORE_EVENT_TYPES = [
  'member.joined',
  'member.role_changed',
  'member.removed',
  'api_key.created',
  'api_key.revoked',
  'tenant.tier_changed',
] as const;

// What a webhook endpoint receives (the body, signed with Standard Webhooks headers: webhook-id is `id`).
export const WebhookPayloadSchema = z.object({
  id: z.string(),
  type: EventTypeSchema,
  tenantId: IdSchema,
  // When it happened, not when this delivery was sent (retries can arrive hours later, and out of order).
  timestamp: TimestampSchema,
  data: z.record(z.string(), z.unknown()),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// Never carries the secret, only the endpoint's settings.
export const WebhookEndpointSchema = z.object({
  id: IdSchema,
  url: z.string(),
  description: z.string().nullable(),
  // The event types sent here; empty means all of them.
  events: z.array(EventTypeSchema),
  enabled: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

// `secret` is returned this once (at creation or rotation): it signs every delivery, and receivers verify with it.
export const WebhookSecretSchema = z.object({ secret: z.string() });
export type WebhookSecret = z.infer<typeof WebhookSecretSchema>;
export const CreatedWebhookEndpointSchema = WebhookEndpointSchema.extend(WebhookSecretSchema.shape);
export type CreatedWebhookEndpoint = z.infer<typeof CreatedWebhookEndpointSchema>;

const UrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const DescriptionSchema = z.string().trim().max(200);
const EventsSchema = z.array(EventTypeSchema).max(50);

export const CreateWebhookEndpointSchema = z.object({
  url: UrlSchema,
  description: DescriptionSchema.optional(),
  events: EventsSchema.default([]),
});
export type CreateWebhookEndpointDto = z.infer<typeof CreateWebhookEndpointSchema>;

export const UpdateWebhookEndpointSchema = z
  .object({ url: UrlSchema, description: DescriptionSchema.nullable(), events: EventsSchema, enabled: z.boolean() })
  .partial()
  .refine((v) => Object.values(v).some((field) => field !== undefined), 'Nothing to update');
export type UpdateWebhookEndpointDto = z.infer<typeof UpdateWebhookEndpointSchema>;

export const WebhookEndpointPageQuerySchema = pageQuery(IdSchema);
export type WebhookEndpointPageQuery = z.infer<typeof WebhookEndpointPageQuerySchema>;

// Every event type an endpoint can subscribe to: core's plus those declared by installed modules.
export const WebhookEventTypesSchema = z.object({ types: z.array(EventTypeSchema) });
export type WebhookEventTypes = z.infer<typeof WebhookEventTypesSchema>;

// Why no response came back from an endpoint.
export const WebhookDeliveryErrorSchema = z.enum(['timeout', 'refused_address', 'network']);
export type WebhookDeliveryError = z.infer<typeof WebhookDeliveryErrorSchema>;

// One attempt. Never the endpoint's response body: that comes from the tenant's server and could contain anything.
export const WebhookDeliverySchema = z.object({
  id: IdSchema,
  endpointId: IdSchema,
  eventId: z.string(),
  eventType: EventTypeSchema,
  attempt: z.number().int(),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int(),
  error: WebhookDeliveryErrorSchema.nullable(),
  nextRetryAt: TimestampSchema.nullable(),
  payload: WebhookPayloadSchema,
  createdAt: TimestampSchema,
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
