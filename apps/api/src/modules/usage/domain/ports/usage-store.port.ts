import type { TenantTier } from '@repo/shared-types';

export const USAGE_COUNTERS = Symbol('UsageCounters');
export const USAGE_RECORDS = Symbol('UsageRecords');

export interface CounterKey {
  tenantId: string;
  meter: string;
}

export interface HourlyCount extends CounterKey {
  hourStart: Date;
  quantity: number;
  // Its hour is over, so this was the last flush it needs.
  closed: boolean;
}

// Fast and approximate: Redis, where a lost counter costs minutes of counting.
export interface UsageCounters {
  // Adds to the month and hour counters, and returns the month's new total.
  add(key: CounterKey, quantity: number, now: Date): Promise<number>;
  // Null when Redis no longer has this month's counter.
  month(key: CounterKey, now: Date): Promise<number | null>;
  // Sets the month's counter unless another instance got there first.
  seedMonth(key: CounterKey, now: Date, quantity: number): Promise<void>;
  // Every hourly counter that has not been flushed for the last time.
  hourlyCounts(now: Date): Promise<HourlyCount[]>;
  forgetHour(count: HourlyCount): Promise<void>;
  // Erases a deleted tenant's counters. Safe to run twice.
  forgetTenant(tenantId: string, meters: readonly string[], now: Date): Promise<void>;
}

export interface UsageRecord extends CounterKey {
  id: string;
  quantity: number;
  reportedQuantity: number;
}

// Durable: usage_records, one row per tenant, meter and hour.
export interface UsageRecords {
  // Never lowers a count: a restarted Redis counts from zero again. Null when the tenant no longer exists.
  store(count: HourlyCount): Promise<UsageRecord | null>;
  monthTotal(key: CounterKey, periodStart: Date): Promise<number>;
  tierOf(tenantId: string): Promise<TenantTier | null>;
  // A tenant event, so it goes through the outbox like any other.
  reportThreshold(key: CounterKey, percent: number, limit: number): Promise<void>;
}
