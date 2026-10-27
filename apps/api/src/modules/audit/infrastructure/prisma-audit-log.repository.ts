import { Injectable } from '@nestjs/common';
import type { AuditLogEntry, CursorPage } from '@repo/shared-types';
import { keysetArgs, keysetPage, type KeysetCursor } from '../../../common/keyset.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { AuditLogRepository } from '../domain/ports/audit-log.repository.js';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, { cursor, limit }: { cursor?: KeysetCursor; limit: number }): Promise<CursorPage<AuditLogEntry>> {
    // Served by the (tenant_id, created_at, id) index.
    const page = keysetArgs('createdAt', 'desc', cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, ...(page.where as Prisma.AuditLogWhereInput) },
      orderBy: page.orderBy as Prisma.AuditLogOrderByWithRelationInput[],
      take: limit + 1,
      omit: { tenantId: true },
    });
    const items = rows.map((r) => ({
      ...r,
      actorKind: r.actorKind as AuditLogEntry['actorKind'],
      createdAt: r.createdAt.toISOString(),
    }));
    return keysetPage(items, limit, (e) => e.createdAt);
  }
}
