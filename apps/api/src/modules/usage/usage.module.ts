import { Global, Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { OPTIONAL_MODULES, type OptionalModule } from '../system/domain/optional-module.js';
import { TenantDeletionHooks } from '../tenancy/domain/tenant-deletion-hooks.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { USAGE_COUNTERS, USAGE_RECORDS, type UsageCounters, type UsageRecords } from './domain/ports/usage-store.port.js';
import { UsageMeter } from './domain/usage-meter.js';
import { PrismaUsageRecords } from './infrastructure/prisma-usage-records.js';
import { RedisUsageCounters } from './infrastructure/redis-usage-counters.js';
import { UsageAlerts } from './infrastructure/usage-alerts.js';
import { UsageFlush } from './infrastructure/usage-flush.js';
import { QuotaGuard } from './presentation/enforce-quota.js';
import { UsageController } from './presentation/usage.controller.js';

const logger = new Logger('UsageMeter');

// Global, like TenantEvents: any module may count usage or use @EnforceQuota without importing this one.
@Global()
@Module({
  imports: [TenancyModule, MailModule],
  controllers: [UsageController],
  providers: [
    { provide: USAGE_COUNTERS, useClass: RedisUsageCounters },
    { provide: USAGE_RECORDS, useClass: PrismaUsageRecords },
    {
      provide: UsageMeter,
      inject: [OPTIONAL_MODULES, USAGE_COUNTERS, USAGE_RECORDS],
      useFactory: (modules: OptionalModule[], counters: UsageCounters, records: UsageRecords) =>
        new UsageMeter(modules.flatMap((m) => m.meters ?? []), counters, records, (message) => logger.error(message)),
    },
    UsageFlush,
    UsageAlerts,
    QuotaGuard,
  ],
  exports: [UsageMeter, QuotaGuard],
})
export class UsageModule implements OnModuleInit {
  constructor(
    private readonly usage: UsageMeter,
    @Inject(USAGE_COUNTERS) private readonly counters: UsageCounters,
    private readonly deletionHooks: TenantDeletionHooks,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register((tenantId) => this.counters.forgetTenant(tenantId, this.usage.meters(), new Date()));
  }
}
