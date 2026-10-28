import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CursorPage, Role, StoredFile, StoredFilePageQuery } from '@repo/shared-types';
import { z } from 'zod';
import { toCursorPage } from '../../../common/cursor-page.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import {
  INTEGRATION_SERVICE,
  type IntegrationService,
} from '../../../modules/integrations/domain/ports/integration.service.js';
import { TenantDeletionHooks } from '../../../modules/tenancy/domain/tenant-deletion-hooks.js';
import { mayDeleteFile } from '../domain/file-access.js';
import { isTenantObjectKey } from '../domain/object-key.js';
import { fitsPlatformQuota } from '../domain/platform-quota.js';
import {
  StorageForbiddenError,
  StorageNotConfiguredError,
  StorageObjectNotFoundError,
  StorageQuotaExceededError,
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
// Files in the platform bucket are tracked (storage_objects), which is also how a key is known to live
// there; any other key can only be in the tenant's own bucket. The API itself only ever sends requests
// to the platform bucket, never to a tenant-chosen endpoint.
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger('Storage');
  private readonly platform: StorageConfig | null;

  constructor(
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
    private readonly prisma: PrismaService,
    config: ConfigService,
    deletionHooks: TenantDeletionHooks,
  ) {
    this.platform = platformConfig(config);
    deletionHooks.register((tenantId) => this.forgetTenant(tenantId));
  }

  async presignUpload(tenantId: string, key: string, size: number, uploaderId: string): Promise<PresignedUrl> {
    assertTenantKey(tenantId, key);
    // Signed, so the store refuses a body of any other size.
    const headers = { 'content-length': String(size) };
    const own = await this.ownBucket(tenantId);
    if (own) return sign(own, 'PUT', key, { headers });
    const platform = this.platformBucket();
    await this.reserve(tenantId, { key, size, uploaderId });
    return sign(platform, 'PUT', key, { headers });
  }

  // Served as a download, never rendered inline, so an uploaded HTML file can't run in the browser.
  async presignDownload(tenantId: string, key: string): Promise<PresignedUrl> {
    assertTenantKey(tenantId, key);
    const bucket = (await this.isOnPlatform(tenantId, key)) ? this.platformBucket() : await this.ownBucket(tenantId);
    if (!bucket) throw new StorageObjectNotFoundError();
    return sign(bucket, 'GET', key, { query: { 'response-content-disposition': 'attachment' } });
  }

  async delete(tenantId: string, key: string, caller: { id: string; role: Role }): Promise<void> {
    assertTenantKey(tenantId, key);
    const file = await this.prisma.storageObject.findFirst({ where: { tenantId, key }, select: { uploaderId: true } });
    if (!file) throw new StorageObjectNotFoundError();
    if (!mayDeleteFile(caller, file.uploaderId)) throw new StorageForbiddenError();
    await this.deleteFromPlatform(key);
    await this.prisma.storageObject.deleteMany({ where: { tenantId, key } });
  }

  // Newest first: ids are UUIDv7, so id order is creation order, served by the (tenant_id, id) index.
  async list(tenantId: string, { cursor, limit }: StoredFilePageQuery): Promise<CursorPage<StoredFile>> {
    const rows = await this.prisma.storageObject.findMany({
      where: { tenantId, ...(cursor && { id: { lt: cursor } }) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: { id: true, key: true, size: true, uploaderId: true, createdAt: true },
    });
    const files = rows.map((r) => ({ ...r, filename: r.key.split('/').at(-1) ?? r.key, createdAt: r.createdAt.toISOString() }));
    return toCursorPage(files, limit, (f) => f.id);
  }

  // Tenant deleted: its files in the platform bucket go too (their rows follow by cascade). Files in its
  // own bucket are its own to keep or delete.
  async forgetTenant(tenantId: string): Promise<void> {
    const objects = await this.prisma.storageObject.findMany({ where: { tenantId }, select: { key: true } });
    if (objects.length === 0) return;
    if (!this.platform) {
      this.logger.warn(`Tenant ${tenantId} has ${objects.length} platform files but STORAGE_* is unset: left in the bucket`);
      return;
    }
    // A few at a time: at most PLATFORM_QUOTA.objects files, without flooding the store.
    for (let i = 0; i < objects.length; i += 10) {
      await Promise.all(objects.slice(i, i + 10).map(({ key }) => this.deleteFromPlatform(key)));
    }
  }

  private async reserve(tenantId: string, file: { key: string; size: number; uploaderId: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serializes a tenant's concurrent uploads, so two cannot both take the last free space. NO KEY: plain
      // FOR UPDATE would also block every insert that references the tenant (audit logs, API keys, ...).
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR NO KEY UPDATE`;
      const used = await tx.storageObject.aggregate({ where: { tenantId }, _sum: { size: true }, _count: true });
      if (!fitsPlatformQuota({ bytes: used._sum.size ?? 0, objects: used._count }, file.size)) {
        throw new StorageQuotaExceededError('Storage quota reached: delete files or configure your own bucket');
      }
      await tx.storageObject.create({ data: { tenantId, ...file } });
    });
  }

  private async deleteFromPlatform(key: string): Promise<void> {
    const { url } = sign(this.platformBucket(), 'DELETE', key);
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
    // 404: never uploaded (only reserved), or already deleted by an earlier attempt.
    if (!res.ok && res.status !== 404) throw new Error(`Storage answered ${res.status} to a DELETE`);
  }

  private async isOnPlatform(tenantId: string, key: string): Promise<boolean> {
    return (await this.prisma.storageObject.count({ where: { tenantId, key } })) > 0;
  }

  private platformBucket(): StorageConfig {
    if (!this.platform) {
      throw new StorageNotConfiguredError('No storage credentials: configure the "r2" integration or set STORAGE_*');
    }
    return this.platform;
  }

  // The tenant's own bucket (BYOK), when configured and enabled.
  private async ownBucket(tenantId: string): Promise<StorageConfig | null> {
    const secrets = await this.integrations.getSecrets(tenantId, 'r2');
    if (!secrets) return null;
    const parsed = StorageConfigSchema.safeParse(secrets);
    if (!parsed.success) {
      throw new StorageNotConfiguredError('The "r2" integration needs endpoint, bucket, accessKeyId and secretAccessKey');
    }
    return parsed.data;
  }
}

function assertTenantKey(tenantId: string, key: string): void {
  if (!isTenantObjectKey(tenantId, key)) throw new Error('Object key outside the tenant prefix');
}

function sign(
  { endpoint, region, bucket, accessKeyId, secretAccessKey }: StorageConfig,
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  extra: { query?: Record<string, string>; headers?: Record<string, string> } = {},
): PresignedUrl {
  const now = new Date();
  const url = presignS3Url({
    method,
    endpoint,
    path: `/${bucket}/${key}`,
    region,
    accessKeyId,
    secretAccessKey,
    expiresIn: URL_TTL_SECONDS,
    now,
    ...extra,
  });
  return { url, expiresAt: new Date(now.getTime() + URL_TTL_SECONDS * 1000) };
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
