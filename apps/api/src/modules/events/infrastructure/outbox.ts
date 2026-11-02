import { context, propagation } from '@opentelemetry/api';
import type { Prisma } from '../../../generated/prisma/client.js';

// Reports something that happened in a tenant. Call it in the transaction of the change itself, so the event commits
// or rolls back with it; OutboxRelay delivers it. `data` carries ids and roles, never emails, names or secrets.
export async function recordEvent(tx: Prisma.TransactionClient, tenantId: string, type: string, data: Prisma.InputJsonObject = {}): Promise<void> {
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  await tx.outboxEvent.create({ data: { tenantId, type, data, traceContext } });
}
