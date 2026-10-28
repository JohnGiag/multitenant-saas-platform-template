import { Injectable } from '@nestjs/common';
import type { AuditLogEntry, AuditLogFilter, CursorPage } from '@repo/shared-types';
import { keysetArgs, keysetPage, type KeysetCursor } from '../../../common/keyset.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { AuditLogRepository } from '../domain/ports/audit-log.repository.js';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    { cursor, limit, actorId, targetId, from, to }: AuditLogFilter & { cursor?: KeysetCursor; limit: number },
  ): Promise<CursorPage<AuditLogEntry>> {
    // Served by (tenant_id, created_at, id), or by (tenant_id, actor_id | target_id, created_at, id) when
    // filtered. Unset filters are undefined, which Prisma drops: here that is what we want.
    const page = keysetArgs('createdAt', 'desc', cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, actorId, targetId, createdAt: { gte: from, lt: to }, ...(page.where as Prisma.AuditLogWhereInput) },
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
