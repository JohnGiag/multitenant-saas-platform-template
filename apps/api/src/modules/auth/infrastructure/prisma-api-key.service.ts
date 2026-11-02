import { Injectable } from '@nestjs/common';
import type { ApiKeySummary, CreateApiKeyDto, CreatedApiKey, CursorPage, Principal } from '@repo/shared-types';
import { keysetArgs, keysetPage, type KeysetCursor } from '../../../common/keyset.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { recordEvent } from '../../events/infrastructure/outbox.js';
import { apiKeySecretMatches, generateApiKey, hashApiKeySecret, parseApiKey } from '../domain/api-key.js';
import type { ApiKeyService } from '../domain/ports/api-key.port.js';

@Injectable()
export class PrismaApiKeyService implements ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, { name, role }: CreateApiKeyDto): Promise<CreatedApiKey> {
    const key = generateApiKey();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { tenantId, name, role, prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) },
      });
      await recordEvent(tx, tenantId, 'api_key.created', { apiKeyId: created.id, role: created.role });
      return created;
    });
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      prefix: row.prefix,
      key: key.raw,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(tenantId: string, { cursor, limit }: { cursor?: KeysetCursor; limit: number }) {
    // Served by the (tenant_id, created_at, id) index.
    const page = keysetArgs('createdAt', 'desc', cursor);
    const rows = await this.prisma.apiKey.findMany({
      where: { tenantId, ...(page.where as Prisma.ApiKeyWhereInput) },
      orderBy: page.orderBy as Prisma.ApiKeyOrderByWithRelationInput[],
      take: limit + 1,
      select: { id: true, name: true, role: true, prefix: true, createdAt: true, revokedAt: true },
    });
    const items: ApiKeySummary[] = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
    return keysetPage(items, limit, (k) => k.createdAt) satisfies CursorPage<ApiKeySummary>;
  }

  revoke(tenantId: string, id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.apiKey.updateMany({
        where: { id, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 1) await recordEvent(tx, tenantId, 'api_key.revoked', { apiKeyId: id });
      return count === 1;
    });
  }

  async verify(rawKey: string): Promise<Principal | null> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return null;
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      include: { tenant: { select: { tier: true } } },
    });
    if (!row || row.revokedAt || !apiKeySecretMatches(parsed.secret, row.secretHash)) return null;
    return { kind: 'apiKey', id: row.id, tenantId: row.tenantId, role: row.role, tier: row.tenant.tier };
  }
}
