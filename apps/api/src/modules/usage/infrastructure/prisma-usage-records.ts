import { Injectable } from '@nestjs/common';
import type { TenantTier } from '@repo/shared-types';
import { hasCode } from '../../../common/prisma-errors.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { recordEvent } from '../../events/infrastructure/outbox.js';
import type { CounterKey, HourlyCount, UsageRecord, UsageRecords } from '../domain/ports/usage-store.port.js';
import { nextPeriodStart } from '../domain/usage-policy.js';

const TIER_CACHE_MS = 60_000;

@Injectable()
export class PrismaUsageRecords implements UsageRecords {
  // shortcut: a tier change reaches quotas up to a minute late, because metered routes are the hot ones. Invalidate it
  // through TenantEvents if a plan change must apply at once.
  private readonly tiers = new Map<string, { tier: TenantTier | null; readAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async store({ tenantId, meter, hourStart, quantity }: HourlyCount): Promise<UsageRecord | null> {
    const key = { tenantId, meter, periodStart: hourStart };
    const { count } = await this.prisma.usageRecord.updateMany({ where: { ...key, quantity: { lt: quantity } }, data: { quantity } });
    if (count === 0) {
      try {
        await this.prisma.usageRecord.createMany({ data: { ...key, quantity }, skipDuplicates: true });
      } catch (error) {
        // The tenant was deleted while its counter waited: the foreign key refuses the row.
        if (hasCode(error, 'P2003')) return null;
        throw error;
      }
    }
    return this.prisma.usageRecord.findUnique({
      where: { tenantId_meter_periodStart: key },
      select: { id: true, tenantId: true, meter: true, quantity: true, reportedQuantity: true },
    });
  }

  async monthTotal({ tenantId, meter }: CounterKey, periodStart: Date): Promise<number> {
    const { _sum } = await this.prisma.usageRecord.aggregate({
      where: { tenantId, meter, periodStart: { gte: periodStart, lt: nextPeriodStart(periodStart) } },
      _sum: { quantity: true },
    });
    return _sum.quantity ?? 0;
  }

  async tierOf(tenantId: string): Promise<TenantTier | null> {
    const cached = this.tiers.get(tenantId);
    if (cached && Date.now() - cached.readAt < TIER_CACHE_MS) return cached.tier;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true, liveTenant: { select: { tier: true } } } });
    // A sandbox has no plan of its own.
    const tier = tenant && (tenant.liveTenant?.tier ?? tenant.tier);
    this.tiers.set(tenantId, { tier, readAt: Date.now() });
    return tier;
  }

  reportThreshold({ tenantId, meter }: CounterKey, percent: number, limit: number): Promise<void> {
    return this.prisma.$transaction((tx) => recordEvent(tx, tenantId, 'usage.threshold_reached', { meter, percent, limit }));
  }
}
