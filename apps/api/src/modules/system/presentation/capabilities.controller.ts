import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapabilityResponseSchema, type CapabilityResponse } from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { Roles } from '../../auth/presentation/decorators.js';
import { FeatureFlags } from '../../feature-flags/domain/feature-flags.js';
import { INTEGRATION_SERVICE, type IntegrationService } from '../../integrations/domain/ports/integration.service.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { OPTIONAL_MODULES, toCapabilities, type OptionalModule } from '../domain/optional-module.js';

@Controller('system')
export class CapabilitiesController {
  constructor(
    @Inject(OPTIONAL_MODULES) private readonly modules: OptionalModule[],
    @Inject(INTEGRATION_SERVICE) private readonly integrations: IntegrationService,
    private readonly flags: FeatureFlags,
    private readonly config: ConfigService,
  ) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @ApiDoc('Installed optional modules, and whether each is enabled for the current tenant', CapabilityResponseSchema)
  @Get('capabilities')
  async capabilities(@TenantId() tenantId: string): Promise<CapabilityResponse> {
    const providers = this.modules.flatMap((m) => (m.integration ? [m.integration] : []));
    const [enabled, flags] = await Promise.all([this.integrations.enabledProviders(tenantId, providers), this.flags.list(tenantId)]);
    const flagsOff = new Set(flags.filter((f) => !f.enabled).map((f) => f.key));
    return { capabilities: toCapabilities(this.modules, enabled, (name) => this.config.get<string>(name) || undefined, flagsOff) };
  }
}
