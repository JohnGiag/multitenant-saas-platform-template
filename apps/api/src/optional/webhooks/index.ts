import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { WEBHOOKS_FEATURE } from './domain/ports/webhook.service.js';
import { WebhooksModule } from './webhooks.module.js';

// Outbound webhooks: the tenant's events (TenantEvents) delivered to its own HTTPS endpoints, signed with Standard
// Webhooks. Needs no configuration. Delete this folder to uninstall: events then go nowhere, and webhook_endpoints
// stays unused. On for every tier; set minTier to 'pro' to sell it with a plan.
export default {
  key: 'webhooks',
  featureFlags: [{ key: WEBHOOKS_FEATURE, minTier: 'free' }],
  module: WebhooksModule,
} satisfies OptionalModule;
