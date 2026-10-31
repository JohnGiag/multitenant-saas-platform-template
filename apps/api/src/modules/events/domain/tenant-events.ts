import { randomUUID } from 'node:crypto';
import { CORE_EVENT_TYPES } from '@repo/shared-types';

// Something that happened in a tenant, for whoever listens (the optional webhooks module delivers it to the tenant's
// endpoints). `data` carries ids and roles, never emails, names or secrets: it leaves the platform.
export interface TenantEvent {
  id: string;
  type: string;
  tenantId: string;
  occurredAt: Date;
  data: Record<string, unknown>;
}

export type TenantEventListener = (event: TenantEvent) => Promise<void>;

// In-process fan-out: core and modules publish, listeners subscribe in their onModuleInit. With no listener (webhooks
// not installed), publishing does nothing.
// shortcut: published after the change commits, so an event is lost if a listener fails then (e.g. Redis down while
// queueing); write events to an outbox table in the same transaction if delivery must be guaranteed.
export class TenantEvents {
  private readonly listeners: TenantEventListener[] = [];
  private readonly types = new Set<string>(CORE_EVENT_TYPES);

  constructor(private readonly reportFailure: (message: string) => void) {}

  // Event types a module publishes beyond core's, so endpoints can subscribe to them.
  declare(...types: string[]): void {
    for (const type of types) this.types.add(type);
  }

  declaredTypes(): string[] {
    return [...this.types].sort();
  }

  subscribe(listener: TenantEventListener): void {
    this.listeners.push(listener);
  }

  // Never throws: the change it reports has already happened, and failing the caller's response now would only make
  // its client retry the change. Each listener holds up that response, so it must give up soon (see withTimeout).
  async publish(tenantId: string, type: string, data: Record<string, unknown> = {}): Promise<void> {
    const event: TenantEvent = { id: `evt_${randomUUID()}`, type, tenantId, occurredAt: new Date(), data };
    for (const listener of this.listeners) {
      await listener(event).catch((err: unknown) =>
        this.reportFailure(`Event ${event.id} (${type}) lost for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}
