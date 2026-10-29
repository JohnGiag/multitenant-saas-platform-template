import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { WebhooksModule } from './webhooks.module.js';

// Outbound webhooks: the tenant's events (TenantEvents) delivered to its own HTTPS endpoints, signed with Standard
// Webhooks. Needs no configuration. Delete this folder to uninstall: publishing events then does nothing, and
// webhook_endpoints stays unused.
export default { key: 'webhooks', module: WebhooksModule } satisfies OptionalModule;
