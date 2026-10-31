import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { FeatureFlagRepository, TenantFeatureState } from '../domain/ports/feature-flag.repository.js';

@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: string): Promise<TenantFeatureState | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tier: true, featureFlags: { select: { key: true, enabled: true } } },
    });
    return tenant && { tier: tenant.tier, overrides: new Map(tenant.featureFlags.map((f) => [f.key, f.enabled])) };
  }

  async setOverride(tenantId: string, key: string, enabled: boolean): Promise<void> {
    await this.prisma.tenantFeatureFlag.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, enabled },
      update: { enabled },
    });
  }

  async clearOverride(tenantId: string, key: string): Promise<void> {
    await this.prisma.tenantFeatureFlag.deleteMany({ where: { tenantId, key } });
  }
}
