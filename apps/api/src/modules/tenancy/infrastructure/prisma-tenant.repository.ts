import { Injectable } from '@nestjs/common';
import type { AdminUpdateTenantDto, CreateTenantDto, CursorPage, Tenant, TenantPageQuery } from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import { hasCode } from '../../../common/prisma-errors.js';
import type { Tenant as TenantRow } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { TenantRepository } from '../domain/ports/tenant.repository.js';
import { TenantDeletionHooks } from '../domain/tenant-deletion-hooks.js';

const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  tier: row.tier,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deletionHooks: TenantDeletionHooks,
  ) {}

  async create(input: CreateTenantDto): Promise<Tenant> {
    return toTenant(await this.prisma.tenant.create({ data: input }));
  }

  async list({ cursor, limit }: TenantPageQuery): Promise<CursorPage<Tenant>> {
    // UUIDv7 ids sort by creation time, so the primary key is the keyset.
    const rows = await this.prisma.tenant.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return toCursorPage(rows.map(toTenant), limit, (t) => t.id);
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    return row && toTenant(row);
  }

  async update(id: string, input: AdminUpdateTenantDto): Promise<Tenant | null> {
    try {
      return toTenant(await this.prisma.tenant.update({ where: { id }, data: input }));
    } catch (error) {
      if (hasCode(error, 'P2025')) return null;
      throw error;
    }
  }

  async delete(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { _count: { select: { users: { where: { role: 'SuperAdmin' } } } } },
    });
    if (!tenant) return 'not_found' as const;
    // The platform tenant: deleting it would delete every SuperAdmin and lock the platform out. The API
    // never creates or demotes SuperAdmins, so a tenant cannot gain or lose this protection through it.
    if (tenant._count.users > 0) return 'protected' as const;
    // First, while the tenant's secrets still exist: a hook that fails leaves the tenant for a retry.
    await this.deletionHooks.run(id);
    const where = { tenantId: id };
    const [, , , , , , { count }] = await this.prisma.$transaction([
      // Its members' own actions; what a SuperAdmin did to it stays in the SuperAdmin's tenant.
      this.prisma.auditLog.deleteMany({ where }),
      this.prisma.tenantIntegration.deleteMany({ where }),
      this.prisma.tenantFeatureFlag.deleteMany({ where }),
      this.prisma.apiKey.deleteMany({ where }),
      this.prisma.invitation.deleteMany({ where }),
      // Also removes their push devices, password resets and sessions (cascade).
      this.prisma.user.deleteMany({ where }),
      this.prisma.tenant.deleteMany({ where: { id } }),
    ]);
    return count === 1 ? ('deleted' as const) : ('not_found' as const);
  }
}
