import { Module } from '@nestjs/common';
import { AUDIT_LOG_REPOSITORY } from './domain/ports/audit-log.repository.js';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository.js';
import { AuditLogsController } from './presentation/audit-logs.controller.js';

// Reading the audit trail. Writing it is AuditInterceptor, registered app-wide in AppModule.
@Module({
  controllers: [AuditLogsController],
  providers: [{ provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository }],
})
export class AuditModule {}
