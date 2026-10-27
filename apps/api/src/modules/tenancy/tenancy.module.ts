import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository.js';
import { TenantDeletionHooks } from './domain/tenant-deletion-hooks.js';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository.js';
import { TenantContextGuard } from './presentation/tenant-context.js';
import { TenantsController } from './presentation/tenants.controller.js';

// TenantContextGuard is registered globally by AppModule, last in the guard chain.
@Module({
  controllers: [TenantsController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    TenantContextGuard,
    TenantDeletionHooks,
  ],
  // TENANT_REPOSITORY: the Clerk webhooks delete a tenant when its Organization is deleted.
  // TenantDeletionHooks: modules erase what they keep outside the database (jobs, stored files).
  exports: [TenantContextGuard, TENANT_REPOSITORY, TenantDeletionHooks],
})
export class TenancyModule {}
