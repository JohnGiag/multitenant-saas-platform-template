import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CreateApiKeySchema, type CreateApiKeyDto, type CreatedApiKey } from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { Roles } from './decorators.js';

@Controller('api-keys')
@Roles('TenantAdmin')
export class ApiKeysController {
  constructor(@Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService) {}

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(tenantId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.apiKeys.revoke(tenantId, id))) throw new NotFoundException();
  }
}
