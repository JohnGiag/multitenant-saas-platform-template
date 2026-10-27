import type { AuditLogEntry, CursorPage } from '@repo/shared-types';

export const AUDIT_LOG_REPOSITORY = Symbol('AuditLogRepository');

// Reads the audit trail; writing it is AuditInterceptor's job.
export interface AuditLogRepository {
  // Newest first. `cursor` is the decoded keyset position of the previous page's last entry.
  list(
    tenantId: string,
    query: { cursor?: { value: string | number; id: string }; limit: number },
  ): Promise<CursorPage<AuditLogEntry>>;
}
