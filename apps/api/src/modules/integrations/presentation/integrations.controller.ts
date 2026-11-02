import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Put, Query } from '@nestjs/common';
import {
  cursorPage,
  IntegrationPageQuerySchema,
  IntegrationProviderSchema,
  TenantIntegrationSchema,
  UpsertTenantIntegrationSchema,
  type CursorPage,
  type IntegrationPageQuery,
  type TenantIntegration,
  type UpsertTenantIntegrationDto,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RequireScope, Roles } from '../../auth/presentation/decorators.js';
import { OPTIONAL_MODULES, type OptionalModule } from '../../system/domain/optional-module.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../domain/ports/integration.service.js';

const ProviderPipe = new ZodValidationPipe(IntegrationProviderSchema);

// Responses only ever carry masked config; secrets are write-only through this API.
// A tenant's own admins only: SuperAdmin manages tenants and their users, not their secrets.
@Controller('integrations')
@RequireScope()
@Roles('TenantAdmin')
export class IntegrationsController {
  constructor(
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
    @Inject(OPTIONAL_MODULES) private readonly modules: OptionalModule[],
  ) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc("List the tenant's integrations, masked values only", cursorPage(TenantIntegrationSchema))
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(IntegrationPageQuerySchema)) query: IntegrationPageQuery,
  ): Promise<CursorPage<TenantIntegration>> {
    return this.integrations.list(tenantId, query);
  }

  @ApiDoc(
    "Set a provider's config (BYOK), stored encrypted with AES-256-GCM. Only providers used by an installed module; others answer 404",
    TenantIntegrationSchema,
  )
  @Put(':provider')
  upsert(
    @TenantId() tenantId: string,
    @Param('provider', ProviderPipe) provider: string,
    @Body(new ZodValidationPipe(UpsertTenantIntegrationSchema)) body: UpsertTenantIntegrationDto,
  ): Promise<TenantIntegration> {
    // Only providers an installed module uses; a typo would otherwise "succeed" and never take effect.
    if (!this.modules.some((m) => m.integration === provider)) {
      throw new NotFoundException(`No installed module uses integration "${provider}"`);
    }
    return this.integrations.upsert(tenantId, provider, body);
  }

  // Not restricted to installed modules, so secrets of an uninstalled module can still be removed.
  @ApiDoc("Remove a provider's config and its secrets")
  @Delete(':provider')
  @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('provider', ProviderPipe) provider: string): Promise<void> {
    if (!(await this.integrations.remove(tenantId, provider))) throw new NotFoundException();
  }
}
