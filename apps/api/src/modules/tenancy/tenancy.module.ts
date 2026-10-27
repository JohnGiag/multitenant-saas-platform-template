import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository.js';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository.js';
import { TenantContextGuard } from './presentation/tenant-context.js';
import { TenantsController } from './presentation/tenants.controller.js';

// TenantContextGuard is registered globally by AppModule, after AuthGuard and RateLimitGuard.
@Module({
  controllers: [TenantsController],
  providers: [{ provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository }, TenantContextGuard],
  exports: [TenantContextGuard],
})
export class TenancyModule {}
