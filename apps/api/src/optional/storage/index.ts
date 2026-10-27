import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { StorageModule } from './storage.module.js';

// File storage on R2 or any S3-compatible store, through presigned URLs. Delete this folder to uninstall.
export default { key: 'storage', integration: 'r2', module: StorageModule } satisfies OptionalModule;
