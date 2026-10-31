import { Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { FeatureFlagKeySchema, FeatureFlagResponseSchema, type FeatureFlagResponse } from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { FeatureFlags } from '../domain/feature-flags.js';
import { FEATURE_FLAG_REPOSITORY, type FeatureFlagRepository } from '../domain/ports/feature-flag.repository.js';

// Overrides are SuperAdmin's alone, like the tier they stand in for: a TenantAdmin could otherwise give the tenant
// paid features. `:id` is the flag and on/off are separate routes because the audit log keeps only the `:id` and the
// route pattern, so it shows which flag went which way.
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(
    private readonly flags: FeatureFlags,
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: FeatureFlagRepository,
  ) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @ApiDoc('Every declared feature flag and its state for the current tenant', FeatureFlagResponseSchema)
  @Get()
  async list(@TenantId() tenantId: string): Promise<FeatureFlagResponse> {
    return { flags: await this.flags.list(tenantId) };
  }

  @Roles('SuperAdmin')
  @ApiDoc('Turn a feature on for the current tenant, whatever its tier')
  @Put(':id/on')
  @HttpCode(204)
  on(@TenantId() tenantId: string, @Param('id', new ZodValidationPipe(FeatureFlagKeySchema)) key: string): Promise<void> {
    return this.set(tenantId, key, true);
  }

  @Roles('SuperAdmin')
  @ApiDoc('Turn a feature off for the current tenant, whatever its tier')
  @Put(':id/off')
  @HttpCode(204)
  off(@TenantId() tenantId: string, @Param('id', new ZodValidationPipe(FeatureFlagKeySchema)) key: string): Promise<void> {
    return this.set(tenantId, key, false);
  }

  // Accepts flags no installed module declares, to clean up after uninstalled ones.
  @Roles('SuperAdmin')
  @ApiDoc("Remove the current tenant's override, back to what its tier gives")
  @Delete(':id')
  @HttpCode(204)
  clear(@TenantId() tenantId: string, @Param('id', new ZodValidationPipe(FeatureFlagKeySchema)) key: string): Promise<void> {
    return this.repository.clearOverride(tenantId, key);
  }

  private async set(tenantId: string, key: string, enabled: boolean): Promise<void> {
    if (!this.flags.declares(key)) throw new NotFoundException('No installed module declares this feature flag');
    await this.repository.setOverride(tenantId, key, enabled);
  }
}
