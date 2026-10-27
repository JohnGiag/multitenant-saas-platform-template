import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CursorPage,
  IntegrationPageQuery,
  TenantIntegration,
  UpsertTenantIntegrationDto,
} from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import type { TenantIntegration as IntegrationRow } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { maskConfig } from '../domain/masking.js';
import type { IntegrationService } from '../domain/ports/integration.service.js';
import { openSecret, parseMasterKey, sealSecret } from '../domain/secret-box.js';

// Never selects encryptedConfig, so ciphertext cannot leak into a response by accident.
const PUBLIC_FIELDS = {
  id: true,
  tenantId: true,
  provider: true,
  enabled: true,
  maskedConfig: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PublicRow = Pick<IntegrationRow, keyof typeof PUBLIC_FIELDS>;

const toIntegration = (row: PublicRow): TenantIntegration => ({
  id: row.id,
  tenantId: row.tenantId,
  provider: row.provider,
  enabled: row.enabled,
  maskedConfig: row.maskedConfig as Record<string, string>,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const context = (tenantId: string, provider: string) => `${tenantId}/${provider}`;

@Injectable()
export class PrismaIntegrationService implements IntegrationService {
  private readonly masterKey: Uint8Array;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.masterKey = parseMasterKey(config.getOrThrow<string>('BYOK_MASTER_KEY'));
  }

  async list(tenantId: string, { cursor, limit }: IntegrationPageQuery): Promise<CursorPage<TenantIntegration>> {
    const rows = await this.prisma.tenantIntegration.findMany({
      where: { tenantId, ...(cursor && { provider: { gt: cursor } }) },
      orderBy: { provider: 'asc' },
      take: limit + 1,
      select: PUBLIC_FIELDS,
    });
    return toCursorPage(rows.map(toIntegration), limit, (i) => i.provider);
  }

  async upsert(tenantId: string, provider: string, { config, enabled }: UpsertTenantIntegrationDto) {
    const data = {
      encryptedConfig: sealSecret(this.masterKey, JSON.stringify(config), context(tenantId, provider)),
      maskedConfig: maskConfig(config),
      ...(enabled !== undefined && { enabled }),
    };
    const row = await this.prisma.tenantIntegration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, ...data },
      update: data,
      select: PUBLIC_FIELDS,
    });
    return toIntegration(row);
  }

  async remove(tenantId: string, provider: string): Promise<boolean> {
    const { count } = await this.prisma.tenantIntegration.deleteMany({ where: { tenantId, provider } });
    return count === 1;
  }

  async getSecrets(tenantId: string, provider: string): Promise<Record<string, string> | null> {
    const row = await this.prisma.tenantIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
      select: { enabled: true, encryptedConfig: true },
    });
    if (!row?.enabled) return null;
    return JSON.parse(openSecret(this.masterKey, row.encryptedConfig, context(tenantId, provider)));
  }
}
