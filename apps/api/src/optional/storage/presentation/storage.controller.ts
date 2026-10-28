import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreateUploadSchema,
  cursorPage,
  PresignedDownloadSchema,
  PresignedUploadSchema,
  StorageKeyQuerySchema,
  StoredFilePageQuerySchema,
  StoredFileSchema,
  type CreateUploadDto,
  type CursorPage,
  type PresignedDownload,
  type PresignedUpload,
  type Principal,
  type StorageKeyQuery,
  type StoredFile,
  type StoredFilePageQuery,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CurrentPrincipal, Roles } from '../../../modules/auth/presentation/decorators.js';
import { TenantId } from '../../../modules/tenancy/presentation/tenant-context.js';
import { isTenantObjectKey, newObjectKey } from '../domain/object-key.js';
import {
  STORAGE_PROVIDER,
  StorageForbiddenError,
  StorageNotConfiguredError,
  StorageObjectNotFoundError,
  StorageQuotaExceededError,
  type PresignedUrl,
  type StorageProvider,
} from '../domain/ports/storage-provider.js';

const KeyPipe = new ZodValidationPipe(StorageKeyQuerySchema);

// Files are tenant business data: SuperAdmin stays out. The bytes never pass through here.
@Controller('storage')
export class StorageController {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  // The client PUTs exactly `size` bytes to `url` before it expires and keeps `key` for later.
  @Roles('TenantAdmin', 'User')
  @ApiDoc(
    'Get a presigned upload URL valid for 15 minutes: PUT exactly `size` bytes to it (at most 1 MB). Counts against the platform quota (409 when full)',
    PresignedUploadSchema,
  )
  @Post('uploads')
  async upload(
    @TenantId() tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateUploadSchema)) { filename, size }: CreateUploadDto,
  ): Promise<PresignedUpload> {
    const key = newObjectKey(tenantId, filename);
    return { key, ...toResponse(await withStorage(this.storage.presignUpload(tenantId, key, size, principal.id))) };
  }

  // GET, so read-only Auditors may use it.
  @Roles('TenantAdmin', 'User', 'Auditor')
  @ApiDoc('Get a presigned download URL valid for 15 minutes; the file is served as an attachment', PresignedDownloadSchema)
  @Get('downloads')
  async download(@TenantId() tenantId: string, @Query(KeyPipe) { key }: StorageKeyQuery): Promise<PresignedDownload> {
    return toResponse(await withStorage(this.storage.presignDownload(tenantId, ownKey(tenantId, key))));
  }

  // Platform-bucket files only (the tracked ones); reads the database, so it works without credentials.
  @Roles('TenantAdmin', 'User', 'Auditor')
  @ApiDoc("List the tenant's files in the platform bucket, newest first", cursorPage(StoredFileSchema))
  @Get('objects')
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(StoredFilePageQuerySchema)) query: StoredFilePageQuery,
  ): Promise<CursorPage<StoredFile>> {
    return this.storage.list(tenantId, query);
  }

  // Frees platform quota. Only the uploader or a TenantAdmin. Files in a tenant's own bucket answer 404:
  // they are managed there.
  @Roles('TenantAdmin', 'User')
  @ApiDoc('Delete a file from the platform bucket and free its quota (the uploader or a TenantAdmin)')
  @Delete('objects')
  @HttpCode(204)
  async remove(
    @TenantId() tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(KeyPipe) { key }: StorageKeyQuery,
  ): Promise<void> {
    await withStorage(this.storage.delete(tenantId, ownKey(tenantId, key), principal));
  }
}

// Another tenant's key answers like a missing one.
function ownKey(tenantId: string, key: string): string {
  if (!isTenantObjectKey(tenantId, key)) throw new NotFoundException();
  return key;
}

async function withStorage<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) throw new ServiceUnavailableException(error.message);
    if (error instanceof StorageQuotaExceededError) throw new ConflictException(error.message);
    if (error instanceof StorageObjectNotFoundError) throw new NotFoundException();
    if (error instanceof StorageForbiddenError) throw new ForbiddenException('Only the uploader or a TenantAdmin may delete this file');
    throw error;
  }
}

function toResponse({ url, expiresAt }: PresignedUrl): PresignedDownload {
  return { url, expiresAt: expiresAt.toISOString() };
}
