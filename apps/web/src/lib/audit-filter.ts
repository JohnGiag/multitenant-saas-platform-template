import { AuditLogFilterSchema } from '@repo/shared-types';
import { z } from 'zod';

const DAY_MS = 86_400_000;

// The audit page's filter form. Its dates are whole UTC days, like the times shown; "To" includes its own day,
// so it becomes the API's exclusive bound at the start of the next day.
const utcDay = (plusDays: number) => z.iso.date().transform((day) => new Date(Date.parse(day) + plusDays * DAY_MS).toISOString());
export const AuditFilterFormSchema = AuditLogFilterSchema.extend({ from: utcDay(0).optional(), to: utcDay(1).optional() });

export const AUDIT_FILTER_KEYS = ['actorId', 'targetId', 'from', 'to'] as const;
