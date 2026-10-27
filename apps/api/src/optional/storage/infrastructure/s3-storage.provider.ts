import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  INTEGRATION_SERVICE,
  type IntegrationService,
} from '../../../modules/integrations/domain/ports/integration.service.js';
import { isTenantObjectKey } from '../domain/object-key.js';
import {
  StorageNotConfiguredError,
  type PresignedUrl,
  type StorageProvider,
} from '../domain/ports/storage-provider.js';
import { presignS3Url } from './sigv4.js';

const URL_TTL_SECONDS = 15 * 60;

// Tenant config (PUT /v1/integrations/r2), or the platform's STORAGE_* variables. R2's region is "auto".
const StorageConfigSchema = z.object({
  endpoint: z.url({ protocol: /^https?$/ }),
  region: z.string().min(1).default('auto'),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});
type StorageConfig = z.infer<typeof StorageConfigSchema>;

const PLATFORM_ENV = {
  endpoint: 'STORAGE_ENDPOINT',
  region: 'STORAGE_REGION',
  bucket: 'STORAGE_BUCKET',
  accessKeyId: 'STORAGE_ACCESS_KEY_ID',
  secretAccessKey: 'STORAGE_SECRET_ACCESS_KEY',
} as const;

// Any S3-compatible store (R2, S3, MinIO). Presigning is local signing: no network call per request.
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly platform: StorageConfig | null;

  constructor(
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
    config: ConfigService,
  ) {
    this.platform = platformConfig(config);
  }

  presignUpload(tenantId: string, key: string): Promise<PresignedUrl> {
    return this.presign(tenantId, 'PUT', key);
  }

  // Served as a download, never rendered inline, so an uploaded HTML file can't run in the browser.
  presignDownload(tenantId: string, key: string): Promise<PresignedUrl> {
    return this.presign(tenantId, 'GET', key, { 'response-content-disposition': 'attachment' });
  }

  private async presign(
    tenantId: string,
    method: 'GET' | 'PUT',
    key: string,
    query?: Record<string, string>,
  ): Promise<PresignedUrl> {
    if (!isTenantObjectKey(tenantId, key)) throw new Error('Object key outside the tenant prefix');
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = await this.configFor(tenantId);
    const now = new Date();
    const url = presignS3Url({
      method,
      endpoint,
      path: `/${bucket}/${key}`,
      region,
      accessKeyId,
      secretAccessKey,
      expiresIn: URL_TTL_SECONDS,
      query,
      now,
    });
    return { url, expiresAt: new Date(now.getTime() + URL_TTL_SECONDS * 1000) };
  }

  // The tenant's own bucket (BYOK) when configured and enabled, else the platform's.
  private async configFor(tenantId: string): Promise<StorageConfig> {
    const secrets = await this.integrations.getSecrets(tenantId, 'r2');
    if (!secrets) {
      if (this.platform) return this.platform;
      throw new StorageNotConfiguredError('No storage credentials: configure the "r2" integration or set STORAGE_*');
    }
    const parsed = StorageConfigSchema.safeParse(secrets);
    if (!parsed.success) {
      throw new StorageNotConfiguredError('The "r2" integration needs endpoint, bucket, accessKeyId and secretAccessKey');
    }
    return parsed.data;
  }
}

// None set: no platform default. Some set: they must all be valid, or the boot fails.
function platformConfig(config: ConfigService): StorageConfig | null {
  const values = Object.fromEntries(
    Object.entries(PLATFORM_ENV).map(([field, name]) => [field, config.get<string>(name) || undefined]),
  );
  if (Object.values(values).every((v) => v === undefined)) return null;
  const parsed = StorageConfigSchema.safeParse(values);
  if (!parsed.success) {
    // Names only: the values include the secret key.
    const bad = parsed.error.issues.map((i) => PLATFORM_ENV[i.path[0] as keyof typeof PLATFORM_ENV]);
    throw new Error(`Platform storage needs valid ${bad.join(', ')} (or none of STORAGE_* set)`);
  }
  return parsed.data;
}
