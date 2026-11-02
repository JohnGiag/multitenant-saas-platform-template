import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
import { ConfigService } from '@nestjs/config';
import {
  AdminUpdateTenantSchema,
  CreateTenantSchema,
  cursorPage,
  TenantPageQuerySchema,
  TenantSchema,
  UpdateTenantSchema,
  type AdminUpdateTenantDto,
  type CreateTenantDto,
  type CursorPage,
  type Tenant,
  type TenantPageQuery,
  type UpdateTenantDto,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RequireScope, Roles } from '../../auth/presentation/decorators.js';
import { OPTIONAL_MODULES, tierIsManaged, type OptionalModule } from '../../system/domain/optional-module.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../domain/ports/tenant.repository.js';
import { Idempotent } from '../../idempotency/presentation/idempotency.guard.js';
import { TenantId } from './tenant-context.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

@Controller('tenants')
@RequireScope()
export class TenantsController {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly config: ConfigService,
    @Inject(OPTIONAL_MODULES) private readonly modules: OptionalModule[],
  ) {}

  // Own tenant (or the X-Tenant-Id target for a SuperAdmin).
  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @ApiDoc('The current tenant (yours, or the X-Tenant-Id one for a SuperAdmin)', TenantSchema)
  @Get('current')
  async current(@TenantId() tenantId: string): Promise<Tenant> {
    return this.found(await this.tenants.findById(tenantId));
  }

  @Roles('SuperAdmin', 'TenantAdmin')
  @LocalAuthOnly()
  @ApiDoc('Rename the current tenant', TenantSchema)
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
  @ApiDoc('Create a tenant (free tier); invite its first TenantAdmin next', TenantSchema)
  @Idempotent()
  @Post()
  create(@Body(new ZodValidationPipe(CreateTenantSchema)) body: CreateTenantDto): Promise<Tenant> {
    return this.tenants.create(body);
  }

  @Roles('SuperAdmin')
  @ApiDoc('List every tenant, oldest first', cursorPage(TenantSchema))
  @Get()
  list(@Query(new ZodValidationPipe(TenantPageQuerySchema)) query: TenantPageQuery): Promise<CursorPage<Tenant>> {
    return this.tenants.list(query);
  }

  @Roles('SuperAdmin')
  @ApiDoc("Rename a tenant or change its tier (in Clerk mode, the tier only: the name is the organization's; with billing on, the name only: 409)", TenantSchema)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AdminUpdateTenantSchema)) body: AdminUpdateTenantDto,
  ): Promise<Tenant> {
    // Clerk mode: the name is the Clerk organization's, and its next organization.updated webhook would undo a
    // rename made here. The tier stays ours.
    if (body.name !== undefined && this.config.get<string>('AUTH_PROVIDER') === 'clerk') {
      throw new ConflictException('Managed in Clerk for this deployment');
    }
    // Billing installed and configured: tiers follow subscriptions, and its next update would undo this one. The
    // current tier sent back unchanged (a form that always sends both fields) is fine.
    const before = body.tier === undefined ? null : this.found(await this.tenants.findById(id));
    if (before && before.tier !== body.tier && tierIsManaged(this.modules, (name) => this.config.get<string>(name) || undefined)) {
      throw new ConflictException('Tiers follow subscriptions in this deployment (billing)');
    }
    return this.found(await this.tenants.update(id, body));
  }

  @Roles('SuperAdmin')
  @LocalAuthOnly()
  @ApiDoc('Delete a tenant and everything it owns: users, keys, integrations, audit records, jobs and files. Never the platform tenant (403)')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const result = await this.tenants.delete(id);
    if (result === 'not_found') throw new NotFoundException();
    if (result === 'protected') throw new ForbiddenException('The platform tenant holds the SuperAdmin accounts and is never deleted');
  }

  private found(tenant: Tenant | null): Tenant {
    if (!tenant) throw new NotFoundException();
    return tenant;
  }
}
