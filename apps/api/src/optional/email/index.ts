import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { EmailModule } from './email.module.js';

// Transactional email through Resend. Delete this folder to uninstall.
export default { key: 'email', integration: 'resend', module: EmailModule } satisfies OptionalModule;
