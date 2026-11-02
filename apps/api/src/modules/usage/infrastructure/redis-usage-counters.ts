import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import type { CounterKey, HourlyCount, UsageCounters } from '../domain/ports/usage-store.port.js';
import { hourStart, periodStart } from '../domain/usage-policy.js';

const ACTIVE = 'usage:active';
const DAY_SECONDS = 24 * 60 * 60;
// Long enough for a flush to catch up after an outage; a month's counter outlives its month.
const HOUR_TTL_SECONDS = 7 * DAY_SECONDS;
const MONTH_TTL_SECONDS = 40 * DAY_SECONDS;

const hourKey = (tenantId: string, meter: string, hourMs: number) => `usage:hour:${tenantId}:${meter}:${hourMs}`;
const monthKey = ({ tenantId, meter }: CounterKey, now: Date) => `usage:month:${tenantId}:${meter}:${periodStart(now).getTime()}`;
const member = (tenantId: string, meter: string, hourMs: number) => `${tenantId}:${meter}:${hourMs}`;

@Injectable()
export class RedisUsageCounters implements UsageCounters {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async add(key: CounterKey, quantity: number, now: Date): Promise<number> {
    const hourMs = hourStart(now).getTime();
    const hour = hourKey(key.tenantId, key.meter, hourMs);
    const month = monthKey(key, now);
    const results = await this.redis
      .multi()
      .incrby(month, quantity)
      .expire(month, MONTH_TTL_SECONDS)
      .incrby(hour, quantity)
      .expire(hour, HOUR_TTL_SECONDS)
      .sadd(ACTIVE, member(key.tenantId, key.meter, hourMs))
      .exec();
    const [error, total] = results?.[0] ?? [new Error('Redis dropped the transaction')];
    if (error) throw error;
    return total as number;
  }

  async month(key: CounterKey, now: Date): Promise<number | null> {
    const value = await this.redis.get(monthKey(key, now));
    return value === null ? null : Number(value);
  }

  async seedMonth(key: CounterKey, now: Date, quantity: number): Promise<void> {
    await this.redis.set(monthKey(key, now), quantity, 'EX', MONTH_TTL_SECONDS, 'NX');
  }

  async hourlyCounts(now: Date): Promise<HourlyCount[]> {
    const members = await this.redis.smembers(ACTIVE);
    if (members.length === 0) return [];
    const currentHour = hourStart(now).getTime();
    const counts = await this.redis.mget(
      members.map((m) => {
        const [tenantId, meter, hourMs] = m.split(':');
        return hourKey(tenantId!, meter!, Number(hourMs));
      }),
    );
    return members.map((m, i) => {
      const [tenantId, meter, hourMs] = m.split(':');
      return {
        tenantId: tenantId!,
        meter: meter!,
        hourStart: new Date(Number(hourMs)),
        quantity: Number(counts[i] ?? 0),
        closed: Number(hourMs) < currentHour,
      };
    });
  }

  async forgetHour({ tenantId, meter, hourStart: start }: HourlyCount): Promise<void> {
    await this.redis.srem(ACTIVE, member(tenantId, meter, start.getTime()));
  }

  async forgetTenant(tenantId: string, meters: readonly string[], now: Date): Promise<void> {
    const members = (await this.redis.smembers(ACTIVE)).filter((m) => m.startsWith(`${tenantId}:`));
    const hours = members.map((m) => {
      const [, meter, hourMs] = m.split(':');
      return hourKey(tenantId, meter!, Number(hourMs));
    });
    const keys = [...hours, ...meters.map((meter) => monthKey({ tenantId, meter }, now))];
    if (keys.length > 0) await this.redis.del(...keys);
    if (members.length > 0) await this.redis.srem(ACTIVE, ...members);
  }
}
