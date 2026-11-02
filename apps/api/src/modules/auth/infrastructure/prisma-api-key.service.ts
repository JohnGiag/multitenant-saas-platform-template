import { Inject, Injectable } from '@nestjs/common';
import { CORE_API_SCOPES, type ApiKeySummary, type CreateApiKeyDto, type CreatedApiKey, type CursorPage, type Principal } from '@repo/shared-types';
import { keysetArgs, keysetPage, type KeysetCursor } from '../../../common/keyset.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { recordEvent } from '../../events/infrastructure/outbox.js';
import { ApiKeyCache, type CachedApiKey } from '../domain/api-key-cache.js';
import { apiKeySecretMatches, generateApiKey, hashApiKeySecret, parseApiKey } from '../domain/api-key.js';
import { ACCESS_REVOCATIONS, type AccessRevocations } from '../domain/ports/access-revocations.port.js';
import type { ApiKeyService } from '../domain/ports/api-key.port.js';

@Injectable()
export class PrismaApiKeyService implements ApiKeyService {
  private readonly cache = new ApiKeyCache();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCESS_REVOCATIONS) private readonly revocations: AccessRevocations,
  ) {}

  async create(tenantId: string, { name, role, scopes = [...CORE_API_SCOPES] }: CreateApiKeyDto): Promise<CreatedApiKey> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { sandboxOf: true } });
    const key = generateApiKey(tenant.sandboxOf ? 'test' : 'live');
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { tenantId, name, role, scopes: [...new Set(scopes)], prefix: key.prefix, secretHash: hashApiKeySecret(key.secret) },
      });
      await recordEvent(tx, tenantId, 'api_key.created', { apiKeyId: created.id, role: created.role });
      return created;
    });
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      scopes: row.scopes,
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
      select: { id: true, name: true, role: true, scopes: true, prefix: true, createdAt: true, revokedAt: true },
    });
    const items: ApiKeySummary[] = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
    return keysetPage(items, limit, (k) => k.createdAt) satisfies CursorPage<ApiKeySummary>;
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.apiKey.updateMany({
        where: { id, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 1) await recordEvent(tx, tenantId, 'api_key.revoked', { apiKeyId: id });
      return count === 1;
    });
    if (revoked) await this.revocations.revoke('apiKey', id);
    return revoked;
  }

  async verify(rawKey: string): Promise<Principal | null> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return null;
    const key = (await this.fromCache(parsed.prefix)) ?? (await this.load(parsed.prefix));
    if (!key || key.principal.mode !== parsed.mode || !apiKeySecretMatches(parsed.secret, key.secretHash)) return null;
    return key.principal;
  }

  // A revocation only means "read it again": the database says if the key is gone, or just has a new tier.
  private async fromCache(prefix: string): Promise<CachedApiKey | undefined> {
    const key = this.cache.get(prefix);
    if (!key) return undefined;
    const { id: apiKeyId, tenantId } = key.principal;
    return (await this.revocations.isKeyRevoked({ tenantId, apiKeyId, loadedAtMs: key.loadedAtMs })) ? undefined : key;
  }

  private async load(prefix: string): Promise<CachedApiKey | null> {
    // Taken before the read, so a revocation during it still counts against this entry.
    const loadedAtMs = Date.now();
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: { tenant: { select: { tier: true, sandboxOf: true, liveTenant: { select: { tier: true } } } } },
    });
    if (!row || row.revokedAt) return null;
    const { tier, sandboxOf, liveTenant } = row.tenant;
    const mode = sandboxOf ? 'test' : 'live';
    // A sandbox has no plan of its own: it gets its live tenant's limits.
    const principal: Principal = { kind: 'apiKey', id: row.id, tenantId: row.tenantId, role: row.role, tier: liveTenant?.tier ?? tier, scopes: row.scopes, mode };
    const key = { principal, secretHash: row.secretHash, loadedAtMs };
    this.cache.set(prefix, key);
    return key;
  }
}
