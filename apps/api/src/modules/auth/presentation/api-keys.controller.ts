import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiKeySummarySchema,
  CreateApiKeySchema,
  CreatedApiKeySchema,
  cursorPage,
  pageQuery,
  type ApiKeySummary,
  type CreateApiKeyDto,
  type CreatedApiKey,
  type CursorPage,
} from '@repo/shared-types';
import { z } from 'zod';
import { ApiDoc } from '../../../common/api-doc.js';
import { keysetCursorSchema } from '../../../common/keyset.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { TenantEvents } from '../../events/domain/tenant-events.js';
import { Roles } from './decorators.js';

// Keys are listed by created_at, so the cursor value must be a timestamp.
const ApiKeyPageQuerySchema = pageQuery(keysetCursorSchema(z.iso.datetime()));

@Controller('api-keys')
@Roles('TenantAdmin')
export class ApiKeysController {
  constructor(
    @Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService,
    private readonly events: TenantEvents,
  ) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc("List the tenant's API keys, newest first (no secrets)", cursorPage(ApiKeySummarySchema))
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(ApiKeyPageQuerySchema)) query: z.infer<typeof ApiKeyPageQuerySchema>,
  ): Promise<CursorPage<ApiKeySummary>> {
    return this.apiKeys.list(tenantId, query);
  }

  @ApiDoc('Create an API key: `key` is returned this once, only its hash is stored', CreatedApiKeySchema)
  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    const created = await this.apiKeys.create(tenantId, body);
    await this.events.publish(tenantId, 'api_key.created', { apiKeyId: created.id, role: created.role });
    return created;
  }

  @ApiDoc('Revoke an API key; it stops working at once')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.apiKeys.revoke(tenantId, id))) throw new NotFoundException();
    await this.events.publish(tenantId, 'api_key.revoked', { apiKeyId: id });
  }
}
