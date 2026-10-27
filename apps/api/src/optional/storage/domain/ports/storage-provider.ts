export const STORAGE_PROVIDER = Symbol('StorageProvider');

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
}

// Hands out short-lived URLs so clients move file bytes straight to and from the bucket, never through the API.
export interface StorageProvider {
  // `key` must lie under the tenant's prefix (see isTenantObjectKey); anything else throws.
  presignUpload(tenantId: string, key: string): Promise<PresignedUrl>;
  presignDownload(tenantId: string, key: string): Promise<PresignedUrl>;
}

// Neither the tenant nor the platform has usable storage credentials.
export class StorageNotConfiguredError extends Error {}
