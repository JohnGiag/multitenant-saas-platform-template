import type {
  CreatedWebhookEndpoint,
  CreateWebhookEndpointDto,
  CursorPage,
  UpdateWebhookEndpointDto,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointPageQuery,
  WebhookSecret,
} from '@repo/shared-types';

export const WEBHOOK_SERVICE = Symbol('WebhookService');
// Named after the module, so it gates the whole of it (see OptionalModule.featureFlags).
export const WEBHOOKS_FEATURE = 'webhooks';

// Enough for a few systems per tenant; each one multiplies every event's deliveries.
export const MAX_ENDPOINTS_PER_TENANT = 10;

export interface WebhookService {
  list(tenantId: string, query: WebhookEndpointPageQuery): Promise<CursorPage<WebhookEndpoint>>;
  // Throws WebhookInputError (bad URL, unknown event type) or WebhookLimitError.
  create(tenantId: string, input: CreateWebhookEndpointDto): Promise<CreatedWebhookEndpoint>;
  // Null when the endpoint is not this tenant's.
  update(tenantId: string, id: string, input: UpdateWebhookEndpointDto): Promise<WebhookEndpoint | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
  // The old secret stops signing at once. Null when the endpoint is not this tenant's.
  rotateSecret(tenantId: string, id: string): Promise<WebhookSecret | null>;
  // Queues a "webhook.test" delivery to this endpoint only. Null when the endpoint is not this tenant's.
  sendTest(tenantId: string, id: string): Promise<'queued' | 'disabled' | null>;
  // Every attempt for this endpoint, newest first. Null when the endpoint is not this tenant's.
  deliveries(tenantId: string, endpointId: string, query: { cursor?: { value: string | number; id: string }; limit: number }): Promise<CursorPage<WebhookDelivery> | null>;
  // Sends a delivery again through the normal path, with its original webhook-id. Null when it is not this tenant's.
  redeliver(tenantId: string, deliveryId: string): Promise<'queued' | 'disabled' | null>;
  eventTypes(): string[];
}

export class WebhookInputError extends Error {}
export class WebhookLimitError extends Error {}
