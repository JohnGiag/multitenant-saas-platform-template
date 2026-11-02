import { Controller, Get } from '@nestjs/common';
import { UsageListSchema, type UsageList } from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { RequireScope, Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { UsageMeter } from '../domain/usage-meter.js';

@Controller('usage')
@RequireScope()
export class UsageController {
  constructor(private readonly usage: UsageMeter) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc("This calendar month's use of every meter, against the tenant's quota", UsageListSchema)
  @Get()
  async list(@TenantId() tenantId: string): Promise<UsageList> {
    return { meters: await this.usage.usage(tenantId) };
  }
}
