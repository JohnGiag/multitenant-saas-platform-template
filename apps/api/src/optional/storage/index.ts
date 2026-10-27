import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { StorageModule } from './storage.module.js';

// File storage on R2 or any S3-compatible store, through presigned URLs. Delete this folder to uninstall
// (the storage_objects table then stays unused).
export default {
  key: 'storage',
  integration: 'r2',
  // The platform bucket (with a quota) serves tenants without their own.
  worksWithoutIntegration: (setting) => setting('STORAGE_ENDPOINT') !== undefined,
  module: StorageModule,
} satisfies OptionalModule;
