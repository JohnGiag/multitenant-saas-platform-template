import { Injectable } from '@nestjs/common';
import type { AdminUpdateTenantDto, CreateTenantDto, CursorPage, Tenant, TenantPageQuery } from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import type { Tenant as TenantRow } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { DeleteTenantResult, TenantRepository } from '../domain/ports/tenant.repository.js';

const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  tier: row.tier,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const hasCode = (error: unknown, code: string) => (error as { code?: unknown } | null)?.code === code;

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async delete(id: string): Promise<DeleteTenantResult> {
    try {
      await this.prisma.tenant.delete({ where: { id } });
      return 'deleted';
    } catch (error) {
      if (hasCode(error, 'P2025')) return 'not_found';
      if (hasCode(error, 'P2003')) return 'has_data';
      throw error;
    }
  }
}
