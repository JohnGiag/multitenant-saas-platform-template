import type { Notification, SendNotificationResult } from '@repo/shared-types';

export const NOTIFICATION_SERVICE = Symbol('NotificationService');

// `closed` is the last event of a stream the server ends (e.g. per-user cap): do not reconnect.
export type NotificationEvent =
  | { type: 'notification'; data: Notification }
  | { type: 'ping'; data: '' }
  | { type: 'closed'; data: string };

// Structural stand-in for an rxjs Observable, so the domain does not depend on rxjs.
export interface EventStream<T> {
  subscribe(observer: { next(value: T): void; complete(): void }): { unsubscribe(): void };
}

export interface NotificationService {
  // Null when the recipient is not a user of this tenant.
  send(tenantId: string, notification: Notification): Promise<SendNotificationResult | null>;
  // Real-time events for one user, published from any API instance.
  stream(tenantId: string, userId: string): EventStream<NotificationEvent>;
}
