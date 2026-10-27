import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { PushModule } from './push.module.js';

// Push notifications through Firebase Cloud Messaging. Delete this folder to uninstall
// (the push_devices table then stays unused).
export default { key: 'push', integration: 'fcm', module: PushModule } satisfies OptionalModule;
