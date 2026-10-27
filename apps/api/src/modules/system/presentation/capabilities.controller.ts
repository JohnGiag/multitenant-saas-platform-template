import { Controller, Get, Inject } from '@nestjs/common';
import type { CapabilityResponse } from '@repo/shared-types';
import { Roles } from '../../auth/presentation/decorators.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../../integrations/domain/ports/integration.service.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { OPTIONAL_MODULES, toCapabilities, type OptionalModule } from '../domain/optional-module.js';

@Controller('system')
export class CapabilitiesController {
  constructor(
    @Inject(OPTIONAL_MODULES) private readonly modules: OptionalModule[],
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
  ) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Get('capabilities')
  async capabilities(@TenantId() tenantId: string): Promise<CapabilityResponse> {
    const providers = this.modules.flatMap((m) => (m.integration ? [m.integration] : []));
    const enabled = await this.integrations.enabledProviders(tenantId, providers);
    return { capabilities: toCapabilities(this.modules, enabled) };
  }
}
