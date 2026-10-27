import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository.js';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository.js';
import { TenantContextGuard } from './presentation/tenant-context.js';
import { TenantsController } from './presentation/tenants.controller.js';

// TenantContextGuard is registered globally by AppModule, last in the guard chain.
@Module({
  controllers: [TenantsController],
  providers: [{ provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository }, TenantContextGuard],
  // TENANT_REPOSITORY: the Clerk webhooks delete a tenant when its Organization is deleted.
  exports: [TenantContextGuard, TENANT_REPOSITORY],
})
export class TenancyModule {}
