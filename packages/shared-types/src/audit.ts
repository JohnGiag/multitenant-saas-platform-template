import { z } from 'zod';
import { IdSchema, RoleSchema, TimestampSchema } from './common.js';

// One recorded write (GET /v1/audit-logs, newest first). Ids and route patterns only: no PII.
export const AuditLogEntrySchema = z.object({
  id: IdSchema,
  actorKind: z.enum(['user', 'apiKey']),
  actorId: IdSchema,
  actorRole: RoleSchema,
  // Set when a SuperAdmin acted on another tenant; that tenant may have been deleted since.
  actedOnTenantId: IdSchema.nullable(),
  method: z.string(),
  // The route pattern, e.g. /v1/users/:id.
  route: z.string(),
  // The `:id` route parameter, if any.
  targetId: z.string().nullable(),
  status: z.number().int(),
  createdAt: TimestampSchema,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// Optional filters on GET /v1/audit-logs, combined with AND. `from` is inclusive, `to` exclusive.
export const AuditLogFilterSchema = z.object({
  actorId: IdSchema.optional(),
  targetId: z.string().min(1).max(200).optional(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
});
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
