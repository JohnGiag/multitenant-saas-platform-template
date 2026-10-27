import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AdminUpdateTenantSchema,
  CreateTenantSchema,
  TenantPageQuerySchema,
  UpdateTenantSchema,
  type AdminUpdateTenantDto,
  type CreateTenantDto,
  type CursorPage,
  type Tenant,
  type TenantPageQuery,
  type UpdateTenantDto,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Roles } from '../../auth/presentation/decorators.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../domain/ports/tenant.repository.js';
import { TenantId } from './tenant-context.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

@Controller('tenants')
export class TenantsController {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  // Own tenant (or the X-Tenant-Id target for a SuperAdmin).
  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Get('current')
  async current(@TenantId() tenantId: string): Promise<Tenant> {
    return this.found(await this.tenants.findById(tenantId));
  }

  @Roles('SuperAdmin', 'TenantAdmin')
  @LocalAuthOnly()
  @Patch('current')
  async updateCurrent(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(UpdateTenantSchema)) body: UpdateTenantDto,
  ): Promise<Tenant> {
    return this.found(await this.tenants.update(tenantId, body));
  }

  // Cross-tenant operations below: SuperAdmin only.
  @Roles('SuperAdmin')
  @LocalAuthOnly()
  @Post()
  create(@Body(new ZodValidationPipe(CreateTenantSchema)) body: CreateTenantDto): Promise<Tenant> {
    return this.tenants.create(body);
  }

  @Roles('SuperAdmin')
  @Get()
  list(@Query(new ZodValidationPipe(TenantPageQuerySchema)) query: TenantPageQuery): Promise<CursorPage<Tenant>> {
    return this.tenants.list(query);
  }

  @Roles('SuperAdmin')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AdminUpdateTenantSchema)) body: AdminUpdateTenantDto,
  ): Promise<Tenant> {
    return this.found(await this.tenants.update(id, body));
  }

  @Roles('SuperAdmin')
  @LocalAuthOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.tenants.delete(id))) throw new NotFoundException();
  }

  private found(tenant: Tenant | null): Tenant {
    if (!tenant) throw new NotFoundException();
    return tenant;
  }
}
