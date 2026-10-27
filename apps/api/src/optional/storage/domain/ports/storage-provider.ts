import type { Role } from '@repo/shared-types';

export const STORAGE_PROVIDER = Symbol('StorageProvider');

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
}

// Hands out short-lived URLs so clients move file bytes straight to and from the bucket, never through
// the API. Uses the tenant's own bucket when configured, else the shared platform bucket (with a quota).
// Every `key` must lie under the tenant's prefix (see isTenantObjectKey); anything else throws.
export interface StorageProvider {
  // The URL accepts exactly `size` bytes. On the platform bucket, reserves them against the quota and
  // records `uploaderId` (the calling user or API key).
  presignUpload(tenantId: string, key: string, size: number, uploaderId: string): Promise<PresignedUrl>;
  presignDownload(tenantId: string, key: string): Promise<PresignedUrl>;
  // Platform-bucket files only (freeing quota); a tenant's own bucket is managed with its own tools.
  // Only the uploader or a TenantAdmin (mayDeleteFile); anyone else gets StorageForbiddenError.
  delete(tenantId: string, key: string, caller: { id: string; role: Role }): Promise<void>;
}

// Neither the tenant nor the platform has usable storage credentials.
export class StorageNotConfiguredError extends Error {}

// The upload would take the tenant past its platform-bucket quota.
export class StorageQuotaExceededError extends Error {}

// No such file in the platform bucket, and the tenant has no bucket of its own to look in.
export class StorageObjectNotFoundError extends Error {}

// The caller may not delete this file: someone else uploaded it.
export class StorageForbiddenError extends Error {}
