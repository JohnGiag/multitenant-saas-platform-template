import { Global, Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantEvents } from './domain/tenant-events.js';
import { OutboxRelay, TENANT_EVENTS_QUEUE } from './infrastructure/outbox-relay.js';
import { TenantEventsWorker } from './infrastructure/tenant-events.worker.js';

// Global, like Prisma: every module may subscribe without importing this one.
@Global()
@Module({
  imports: [TenancyModule, JobsModule.registerQueue(TENANT_EVENTS_QUEUE)],
  providers: [{ provide: TenantEvents, useFactory: () => new TenantEvents() }, OutboxRelay, TenantEventsWorker],
  exports: [TenantEvents],
})
export class EventsModule {}
