import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository.js';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository.js';
import { TenantContextInterceptor } from './presentation/tenant-context.js';
import { TenantsController } from './presentation/tenants.controller.js';

@Module({
  controllers: [TenantsController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class TenancyModule {}
