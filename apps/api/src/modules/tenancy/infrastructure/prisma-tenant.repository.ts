import { Injectable } from '@nestjs/common';
import type { AdminUpdateTenantDto, CreateTenantDto, CursorPage, Tenant, TenantPageQuery } from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import { hasCode } from '../../../common/prisma-errors.js';
import type { Tenant as TenantRow } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { recordEvent } from '../../events/infrastructure/outbox.js';
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
      where: { sandboxOf: null, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return toCursorPage(rows.map(toTenant), limit, (t) => t.id);
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    return row && toTenant(row);
  }

  update(id: string, input: AdminUpdateTenantDto): Promise<Tenant | null> {
    return this.prisma.$transaction(async (tx) => {
      // Locked, so two changes at once each report the tier they really replaced. NO KEY: plain FOR UPDATE would also
      // block every insert that references the tenant.
      const [before] = await tx.$queryRaw<{ tier: Tenant['tier'] }[]>`SELECT tier FROM tenants WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      if (!before) return null;
      const row = await tx.tenant.update({ where: { id }, data: input });
      if (row.tier !== before.tier) await recordEvent(tx, id, 'tenant.tier_changed', { tier: row.tier, previousTier: before.tier });
      return toTenant(row);
    });
  }

  async sandboxOf(liveTenantId: string): Promise<string> {
    const find = () => this.prisma.tenant.findUnique({ where: { sandboxOf: liveTenantId }, select: { id: true } });
    const existing = await find();
    if (existing) return existing.id;
    const { name } = await this.prisma.tenant.findUniqueOrThrow({ where: { id: liveTenantId }, select: { name: true } });
    try {
      const { id } = await this.prisma.tenant.create({ data: { name: `${name.slice(0, 90)} (test)`, sandboxOf: liveTenantId } });
      return id;
    } catch (error) {
      // A concurrent request created it first.
      if (!hasCode(error, 'P2002')) throw error;
      return (await find())!.id;
    }
  }

  async delete(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { sandbox: { select: { id: true } }, _count: { select: { users: { where: { role: 'SuperAdmin' } } } } },
    });
    if (!tenant) return 'not_found' as const;
    // The platform tenant: deleting it would delete every SuperAdmin and lock the platform out. The API
    // never creates or demotes SuperAdmins, so a tenant cannot gain or lose this protection through it.
    if (tenant._count.users > 0) return 'protected' as const;
    // First, while the tenant's secrets still exist: a hook that fails leaves the tenant for a retry.
    const ids = tenant.sandbox ? [tenant.sandbox.id, id] : [id];
    for (const tenantId of ids) await this.deletionHooks.run(tenantId);
    const where = { tenantId: { in: ids } };
    const [, , , , , , , , , { count }] = await this.prisma.$transaction([
      this.prisma.outboxEvent.deleteMany({ where }),
      this.prisma.idempotencyKey.deleteMany({ where }),
      // Its members' own actions; what a SuperAdmin did to it stays in the SuperAdmin's tenant.
      this.prisma.auditLog.deleteMany({ where }),
      this.prisma.tenantIntegration.deleteMany({ where }),
      this.prisma.tenantFeatureFlag.deleteMany({ where }),
      this.prisma.apiKey.deleteMany({ where }),
      this.prisma.invitation.deleteMany({ where }),
      // Also removes their push devices, password resets and sessions (cascade).
      this.prisma.user.deleteMany({ where }),
      this.prisma.tenant.deleteMany({ where: { sandboxOf: id } }),
      this.prisma.tenant.deleteMany({ where: { id } }),
    ]);
    return count === 1 ? ('deleted' as const) : ('not_found' as const);
  }
}
