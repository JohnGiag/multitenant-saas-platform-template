import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreateDownloadSchema,
  CreateUploadSchema,
  type CreateDownloadDto,
  type CreateUploadDto,
  type PresignedDownload,
  type PresignedUpload,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Roles } from '../../../modules/auth/presentation/decorators.js';
import { TenantId } from '../../../modules/tenancy/presentation/tenant-context.js';
import { isTenantObjectKey, newObjectKey } from '../domain/object-key.js';
import {
  STORAGE_PROVIDER,
  StorageNotConfiguredError,
  type PresignedUrl,
  type StorageProvider,
} from '../domain/ports/storage-provider.js';

// Files are tenant business data: SuperAdmin stays out. The bytes never pass through here.
@Controller('storage')
export class StorageController {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  // The client PUTs the bytes to `url` before it expires and keeps `key` to download the file later.
  @Roles('TenantAdmin', 'User')
  @Post('uploads')
  async upload(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateUploadSchema)) { filename }: CreateUploadDto,
  ): Promise<PresignedUpload> {
    const key = newObjectKey(tenantId, filename);
    return { key, ...toResponse(await withStorage(this.storage.presignUpload(tenantId, key))) };
  }

  // GET, so read-only Auditors may use it.
  @Roles('TenantAdmin', 'User', 'Auditor')
  @Get('downloads')
  async download(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(CreateDownloadSchema)) { key }: CreateDownloadDto,
  ): Promise<PresignedDownload> {
    // Another tenant's key answers like a missing one.
    if (!isTenantObjectKey(tenantId, key)) throw new NotFoundException();
    return toResponse(await withStorage(this.storage.presignDownload(tenantId, key)));
  }
}

async function withStorage(pending: Promise<PresignedUrl>): Promise<PresignedUrl> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) throw new ServiceUnavailableException(error.message);
    throw error;
  }
}

function toResponse({ url, expiresAt }: PresignedUrl): PresignedDownload {
  return { url, expiresAt: expiresAt.toISOString() };
}
