import {
  BadRequestException,
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
  ApiScopeListSchema,
  CreateApiKeySchema,
  CreatedApiKeySchema,
  cursorPage,
  pageQuery,
  type ApiKeySummary,
  type ApiScopeList,
  type CreateApiKeyDto,
  type CreatedApiKey,
  type CursorPage,
} from '@repo/shared-types';
import { z } from 'zod';
import { ApiDoc } from '../../../common/api-doc.js';
import { keysetCursorSchema } from '../../../common/keyset.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { ApiScopes } from '../domain/api-scopes.js';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { RequireScope, Roles } from './decorators.js';

// Keys are listed by created_at, so the cursor value must be a timestamp.
const ApiKeyPageQuerySchema = pageQuery(keysetCursorSchema(z.iso.datetime()));

@Controller('api-keys')
@RequireScope()
@Roles('TenantAdmin')
export class ApiKeysController {
  constructor(
    @Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService,
    private readonly scopes: ApiScopes,
  ) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc('The scopes a key can hold', ApiScopeListSchema)
  @Get('scopes')
  listScopes(): ApiScopeList {
    return { scopes: this.scopes.declared() };
  }

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
    const known = new Set(this.scopes.declared());
    const unknown = (body.scopes ?? []).filter((scope) => !known.has(scope));
    if (unknown.length > 0) throw new BadRequestException(`Unknown scopes: ${unknown.join(', ')}`);
    return this.apiKeys.create(tenantId, body);
  }

  @ApiDoc('Revoke an API key; it stops working at once')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.apiKeys.revoke(tenantId, id))) throw new NotFoundException();
  }
}
