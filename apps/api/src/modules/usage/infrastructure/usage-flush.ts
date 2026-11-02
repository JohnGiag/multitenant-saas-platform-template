import { Inject, Injectable } from '@nestjs/common';
import { RetentionSweep } from '../../../common/retention-sweep.js';
import { USAGE_COUNTERS, USAGE_RECORDS, type UsageCounters, type UsageRecords } from '../domain/ports/usage-store.port.js';
import { UsageMeter } from '../domain/usage-meter.js';

const EVERY_MS = 2 * 60 * 1000;

// Copies the hourly counters to usage_records, so a lost Redis costs minutes rather than a month. Each counter carries
// its own tenant. On every instance at once it only writes the same values twice.
@Injectable()
export class UsageFlush extends RetentionSweep {
  protected override readonly everyMs = EVERY_MS;

  constructor(
    @Inject(USAGE_COUNTERS) private readonly counters: UsageCounters,
    @Inject(USAGE_RECORDS) private readonly records: UsageRecords,
    private readonly meter: UsageMeter,
  ) {
    super();
  }

  protected sweep() {
    return this.flush();
  }

  async flush(): Promise<void> {
    for (const count of await this.counters.hourlyCounts(new Date())) {
      const record = await this.records.store(count);
      // Reported now too if an earlier flush stored it and stopped there: listeners go by what is still unreported.
      if (record && record.quantity > record.reportedQuantity) await this.meter.flushed(record);
      if (!record || count.closed) await this.counters.forgetHour(count);
    }
  }
}
