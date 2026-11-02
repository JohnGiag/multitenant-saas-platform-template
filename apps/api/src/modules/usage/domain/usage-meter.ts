import type { MeterDefinition, MeterUsage } from '@repo/shared-types';
import type { UsageCounters, UsageRecord, UsageRecords } from './ports/usage-store.port.js';
import { crossedThresholds, isRefused, periodStart, quotaOf } from './usage-policy.js';

export type UsageRecordListener = (record: UsageRecord) => Promise<void>;

// Counts billable units per tenant. The port modules use, with or without billing: core never imports billing, which
// follows the counts through onFlushed.
export class UsageMeter {
  private readonly listeners: UsageRecordListener[] = [];

  constructor(
    private readonly definitions: readonly MeterDefinition[],
    private readonly counters: UsageCounters,
    private readonly records: UsageRecords,
    private readonly reportFailure: (message: string) => void,
  ) {}

  meters(): string[] {
    return this.definitions.map((d) => d.key);
  }

  onFlushed(listener: UsageRecordListener): void {
    this.listeners.push(listener);
  }

  flushed(record: UsageRecord): Promise<void[]> {
    return Promise.all(this.listeners.map((listener) => listener(record)));
  }

  // Never throws for an outage: losing a count must not fail what was counted. A typo in `meter` does throw.
  async record(tenantId: string, meter: string, quantity = 1): Promise<void> {
    const definition = this.definition(meter);
    const key = { tenantId, meter };
    try {
      const now = new Date();
      await this.used(tenantId, meter, now);
      const after = await this.counters.add(key, quantity, now);
      const tier = await this.records.tierOf(tenantId);
      const quota = tier && quotaOf(definition, tier);
      if (!quota) return;
      for (const percent of crossedThresholds(after - quantity, after, quota.limit)) await this.records.reportThreshold(key, percent, quota.limit);
    } catch (err) {
      this.reportFailure(`Usage of ${meter} not counted for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async usage(tenantId: string, now = new Date()): Promise<MeterUsage[]> {
    const tier = await this.records.tierOf(tenantId);
    return Promise.all(
      this.definitions.map(async (definition) => {
        const used = await this.used(tenantId, definition.key, now);
        const quota = tier && quotaOf(definition, tier);
        return { meter: definition.key, used, limit: quota?.limit ?? null, refused: isRefused(used, quota), periodStart: periodStart(now).toISOString() };
      }),
    );
  }

  // For code without a route; routes use @EnforceQuota. Open when Redis is down, like rate limits for signed-in callers.
  async isRefused(tenantId: string, meter: string, now = new Date()): Promise<boolean> {
    const definition = this.definition(meter);
    try {
      const tier = await this.records.tierOf(tenantId);
      return isRefused(await this.used(tenantId, meter, now), tier && quotaOf(definition, tier));
    } catch (err) {
      this.reportFailure(`Quota of ${meter} not checked for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // Redis has the month's running total; after losing it, the stored hours bring it back.
  private async used(tenantId: string, meter: string, now: Date): Promise<number> {
    const key = { tenantId, meter };
    const counted = await this.counters.month(key, now);
    if (counted !== null) return counted;
    await this.counters.seedMonth(key, now, await this.records.monthTotal(key, periodStart(now)));
    return (await this.counters.month(key, now)) ?? 0;
  }

  private definition(meter: string): MeterDefinition {
    const definition = this.definitions.find((d) => d.key === meter);
    // A typo here would otherwise look like a meter nobody uses.
    if (!definition) throw new Error(`Meter "${meter}" is not declared by any installed module`);
    return definition;
  }
}
