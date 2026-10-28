import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { AuditLogFilterSchema, pageQuery, type AuditLogEntry, type CursorPage, type Principal } from '@repo/shared-types';
import { z } from 'zod';
import { keysetCursorSchema } from '../../../common/keyset.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CurrentPrincipal, Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { AUDIT_LOG_REPOSITORY, type AuditLogRepository } from '../domain/ports/audit-log.repository.js';

// Entries are listed by created_at, so the cursor value must be a timestamp.
const AuditLogPageQuerySchema = pageQuery(keysetCursorSchema(z.iso.datetime())).extend(AuditLogFilterSchema.shape);

@Controller('audit-logs')
export class AuditLogsController {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository) {}

  // A SuperAdmin reads only the platform tenant's trail, which holds all its own actions (with the tenant it
  // acted on); another tenant's trail is that tenant's business, so X-Tenant-Id gets 403.
  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(AuditLogPageQuerySchema)) query: z.infer<typeof AuditLogPageQuerySchema>,
  ): Promise<CursorPage<AuditLogEntry>> {
    if (principal.role === 'SuperAdmin' && tenantId !== principal.tenantId) {
      throw new ForbiddenException("SuperAdmin reads only the platform tenant's audit log");
    }
    return this.auditLogs.list(tenantId, query);
  }
}
