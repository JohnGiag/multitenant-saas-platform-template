import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Put, Query } from '@nestjs/common';
import {
  IntegrationPageQuerySchema,
  IntegrationProviderSchema,
  UpsertTenantIntegrationSchema,
  type CursorPage,
  type IntegrationPageQuery,
  type TenantIntegration,
  type UpsertTenantIntegrationDto,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../domain/ports/integration.service.js';

const ProviderPipe = new ZodValidationPipe(IntegrationProviderSchema);

// Responses only ever carry masked config; secrets are write-only through this API.
@Controller('integrations')
@Roles('SuperAdmin', 'TenantAdmin')
export class IntegrationsController {
  constructor(@Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(IntegrationPageQuerySchema)) query: IntegrationPageQuery,
  ): Promise<CursorPage<TenantIntegration>> {
    return this.integrations.list(tenantId, query);
  }

  @Put(':provider')
  upsert(
    @TenantId() tenantId: string,
    @Param('provider', ProviderPipe) provider: string,
    @Body(new ZodValidationPipe(UpsertTenantIntegrationSchema)) body: UpsertTenantIntegrationDto,
  ): Promise<TenantIntegration> {
    return this.integrations.upsert(tenantId, provider, body);
  }

  @Delete(':provider')
  @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('provider', ProviderPipe) provider: string): Promise<void> {
    if (!(await this.integrations.remove(tenantId, provider))) throw new NotFoundException();
  }
}
