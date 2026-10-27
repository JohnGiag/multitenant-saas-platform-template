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
import { CreateApiKeySchema, type CreateApiKeyDto, type CreatedApiKey, type Principal } from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { CurrentPrincipal, Roles } from './decorators.js';

@Controller('api-keys')
@Roles('TenantAdmin')
export class ApiKeysController {
  constructor(@Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService) {}

  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(principal.tenantId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.apiKeys.revoke(principal.tenantId, id))) throw new NotFoundException();
  }
}
