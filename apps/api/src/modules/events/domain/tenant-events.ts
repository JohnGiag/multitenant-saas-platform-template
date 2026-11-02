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

// In-process fan-out: TenantEventsWorker dispatches, listeners subscribe in their onModuleInit. With no listener
// (webhooks not installed), an event goes nowhere. Events are written with recordEvent (infrastructure/outbox.ts).
export class TenantEvents {
  private readonly listeners: TenantEventListener[] = [];
  private readonly types = new Set<string>(CORE_EVENT_TYPES);

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

  // Every listener runs even if another fails, then the first failure is thrown and the job retries the event for all
  // of them. So a listener must be safe to run twice, and give up soon (see withTimeout).
  async dispatch(event: TenantEvent): Promise<void> {
    const results = await Promise.allSettled(this.listeners.map((listener) => listener(event)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
