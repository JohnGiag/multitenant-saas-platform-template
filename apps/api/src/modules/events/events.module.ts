import { Global, Logger, Module } from '@nestjs/common';
import { TenantEvents } from './domain/tenant-events.js';

const logger = new Logger('TenantEvents');

// Global, like Prisma: every module may publish without importing this one.
@Global()
@Module({
  providers: [{ provide: TenantEvents, useFactory: () => new TenantEvents((message) => logger.error(message)) }],
  exports: [TenantEvents],
})
export class EventsModule {}
